<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { Mic, ClipboardList, PhoneCall } from 'lucide-vue-next';
import { LANGUAGES, type LanguageCode } from '../types';
import { blobToWavBase64, pickRecorderMimeType } from '../services/audio/wavEncoder';
import { speakAloud } from '../services/tts/speakAloud';
import {
  INTAKE_FIELD_LABELS,
  type IntakeFields,
  type IntakeRecord,
  type IntakeConversationTurn,
  type IntakeConverseResponse,
} from '../services/intake/types';
import { logError } from '../utils/diagnostics';

type Phase = 'idle' | 'requesting_mic' | 'recording' | 'thinking' | 'speaking' | 'complete';
type ActiveView = 'speak' | 'visits';

const QUEUE_STORAGE_KEY = 'afrivoice_intake_queue';
const LANGUAGE_LABEL: Partial<Record<LanguageCode, string>> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.name])
);

const EMPTY_FIELDS: IntakeFields = {
  name: null,
  ageOrDob: null,
  phoneNumber: null,
  paymentType: null,
  reasonForVisit: null,
  symptomDuration: null,
  allergies: null,
};

const OPENING_CAPTION = 'Press SPEAK — SabiLine will greet you, and you can just talk from there. No script, no language to pick.';

const activeView = ref<ActiveView>('speak');
const phase = ref<Phase>('idle');
const callStarted = ref(false);
const callStartedAt = ref<number | null>(null);
const detectedLanguage = ref<LanguageCode | null>(null);
const noticeHtml = ref<string | null>(null);
const caption = ref(OPENING_CAPTION);

const turns = ref<IntakeConversationTurn[]>([]);
const fields = ref<IntakeFields>({ ...EMPTY_FIELDS });
const department = ref<string | null>(null);
const appointmentSlot = ref<string | null>(null);
const needsManualReview = ref(false);
const finalRecord = ref<IntakeRecord | null>(null);
const queue = ref<IntakeRecord[]>([]);

const showTypeRow = ref(false);
const typedInput = ref('');

type ReminderState = 'sending' | 'sent' | 'not_configured' | 'error';
const reminderStatus = ref<Record<string, { state: ReminderState; message?: string }>>({});

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let activeStream: MediaStream | null = null;

const waveCanvas = ref<HTMLCanvasElement | null>(null);
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let rafId: number | null = null;

// Tuned for a typical laptop/phone mic in a quiet-ish room — not exact
// science, just enough to tell "patient is talking" from "patient stopped."
const SPEAKING_THRESHOLD = 14;
const SILENCE_HOLD_MS = 1200;
const MAX_RECORDING_MS = 20000;

function loadQueue(): IntakeRecord[] {
  try {
    const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    logError('intake:loadQueue', err);
    return [];
  }
}

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.value));
  } catch (err) {
    logError('intake:saveQueue', err);
  }
}

onMounted(() => {
  queue.value = loadQueue();
});

onBeforeUnmount(() => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  activeStream?.getTracks().forEach((t) => t.stop());
  stopVisualizer();
});

const speakBtnLabel = computed(() => {
  if (phase.value === 'requesting_mic' || phase.value === 'recording') return 'LISTENING';
  if (phase.value === 'thinking') return '···';
  if (phase.value === 'speaking') return 'SPEAKING';
  return 'SPEAK';
});

const stageStatus = computed(() => {
  switch (phase.value) {
    case 'requesting_mic':
    case 'recording':
      return 'Listening…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'SabiLine is speaking…';
    case 'complete':
      return 'Visit complete';
    default:
      return callStarted.value ? 'Tap to reply' : 'Tap to connect the call';
  }
});

const speakBtnStateClass = computed(() => {
  if (phase.value === 'requesting_mic' || phase.value === 'recording') return 'listening';
  if (phase.value === 'thinking') return 'busy';
  if (phase.value === 'speaking') return 'speaking';
  return '';
});

const speakDisabled = computed(() =>
  ['requesting_mic', 'recording', 'thinking', 'speaking', 'complete'].includes(phase.value)
);

// Picks the most accurate notice for a failed turn: a real misconfiguration
// (a required API key missing on this deployment) is a different problem
// from a temporary quota limit, which is different again from anything
// else — showing the generic fallback for all three would leave whoever's
// debugging this guessing at the actual cause.
function failureNotice(data: Pick<IntakeConverseResponse, 'quotaExceeded' | 'notConfigured'>, quotaMessage: string, fallback: string): string {
  if (data.notConfigured) {
    return "SabiLine isn&rsquo;t fully set up on this deployment yet &mdash; a required API key is missing. Please let the site owner know.";
  }
  if (data.quotaExceeded) {
    return quotaMessage;
  }
  return fallback;
}

function resetForNewCall() {
  phase.value = 'idle';
  callStarted.value = false;
  callStartedAt.value = null;
  detectedLanguage.value = null;
  noticeHtml.value = null;
  caption.value = OPENING_CAPTION;
  turns.value = [];
  fields.value = { ...EMPTY_FIELDS };
  department.value = null;
  appointmentSlot.value = null;
  needsManualReview.value = false;
  finalRecord.value = null;
  showTypeRow.value = false;
  typedInput.value = '';
}

/** Shared tail end of every turn — speak the reply, then either wrap up the visit or listen for what's next. */
async function handleSabiLineReply(data: IntakeConverseResponse) {
  const spokenReply = data.spokenReply;
  if (!spokenReply) {
    phase.value = 'idle';
    noticeHtml.value = 'SabiLine had nothing to say back — please try again.';
    return;
  }

  turns.value = [...turns.value, { role: 'model', text: spokenReply }];
  if (data.fields) fields.value = { ...EMPTY_FIELDS, ...data.fields };
  if (data.department !== undefined) department.value = data.department;
  if (data.appointmentSlot !== undefined) appointmentSlot.value = data.appointmentSlot;
  caption.value = spokenReply;

  phase.value = 'speaking';
  const outcome = await speakAloud(spokenReply, detectedLanguage.value ?? 'en');
  if (outcome.usedProvider === 'browser' && outcome.fallbackReason) {
    noticeHtml.value = 'Gemini voice quota reached — spoke via device voice instead.';
  }

  if (data.done) {
    finalizeVisit(Boolean(data.needsManualReview));
  } else {
    phase.value = 'idle';
    await startRecording();
  }
}

async function startCall() {
  callStarted.value = true;
  callStartedAt.value = Date.now();
  phase.value = 'thinking';
  noticeHtml.value = null;

  try {
    const res = await fetch('/api/intake/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startCall: true, history: [], elapsedMinutes: 0 }),
    });
    const data: IntakeConverseResponse = await res.json();

    if (!res.ok || !data.success) {
      if (data.error) logError('intake:startCall', data.error);
      phase.value = 'idle';
      callStarted.value = false;
      noticeHtml.value = failureNotice(
        data,
        "Gemini's free-tier quota is exhausted right now, so SabiLine can't start the call. Please try again later.",
        'Something went wrong connecting the call. Please try again.'
      );
      return;
    }

    await handleSabiLineReply(data);
  } catch (err) {
    logError('intake:startCall', err);
    phase.value = 'idle';
    callStarted.value = false;
    noticeHtml.value = 'Something went wrong connecting the call. Please try again.';
  }
}

async function startRecording() {
  noticeHtml.value = null;
  phase.value = 'requesting_mic';

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    logError('intake:getUserMedia', err);
    phase.value = 'idle';
    noticeHtml.value =
      err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone access was denied. Please allow microphone access in your browser, or use &ldquo;Prefer to type instead&rdquo; below to continue by keyboard.'
        : 'Could not access your microphone. Please check your device settings, or use &ldquo;Prefer to type instead&rdquo; below.';
    return;
  }

  recordedChunks = [];
  const mimeType = pickRecorderMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stopVisualizer();
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = null;
    void handleRecordingStopped();
  };

  mediaRecorder.start();
  phase.value = 'recording';
  startVisualizerAndSilenceDetection(activeStream);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// Draws the wave ring around the SPEAK button from the mic's real audio
// level, and doubles as silence detection: once the patient has clearly
// spoken and then gone quiet for a bit, the recording stops on its own —
// no second tap needed, matching a real phone call rather than a
// press-to-talk radio.
function startVisualizerAndSilenceDetection(stream: MediaStream) {
  try {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
  } catch (err) {
    logError('intake:audioContext', err);
    window.setTimeout(() => {
      if (phase.value === 'recording') stopRecording();
    }, MAX_RECORDING_MS);
    return;
  }

  const data = new Uint8Array(analyser.frequencyBinCount);
  const startedAt = Date.now();
  let hasSpoken = false;
  let silenceStartedAt: number | null = null;
  const canvas = waveCanvas.value;
  const ctx2d = canvas?.getContext('2d') ?? null;

  function draw() {
    if (!analyser) return;
    rafId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;

    if (ctx2d && canvas) {
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);
      const radius = 68 + (avg / 255) * 22;
      ctx2d.beginPath();
      ctx2d.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
      ctx2d.strokeStyle = '#a4374a';
      ctx2d.lineWidth = 3;
      ctx2d.globalAlpha = 0.55;
      ctx2d.stroke();
    }

    if (avg > SPEAKING_THRESHOLD) {
      hasSpoken = true;
      silenceStartedAt = null;
    } else if (hasSpoken) {
      if (silenceStartedAt === null) silenceStartedAt = Date.now();
      else if (Date.now() - silenceStartedAt > SILENCE_HOLD_MS) {
        stopRecording();
        return;
      }
    }

    if (Date.now() - startedAt > MAX_RECORDING_MS) stopRecording();
  }
  draw();
}

function stopVisualizer() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  analyser = null;
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {
      // already closed — nothing to do
    }
    audioCtx = null;
  }
  const canvas = waveCanvas.value;
  const ctx2d = canvas?.getContext('2d');
  if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

async function handleRecordingStopped() {
  phase.value = 'thinking';

  try {
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'audio/webm' });
    if (blob.size === 0) {
      throw new Error('No audio was captured. Please try again, or use "Prefer to type instead" below.');
    }

    const audioBase64 = await blobToWavBase64(blob);
    await sendVoiceTurn(audioBase64);
  } catch (err) {
    logError('intake:processRecording', err);
    phase.value = 'idle';
    noticeHtml.value = err instanceof Error ? err.message : 'Could not process the recording. Please try again.';
  }
}

async function sendVoiceTurn(audioBase64: string) {
  const elapsedMinutes = callStartedAt.value ? Math.round((Date.now() - callStartedAt.value) / 60000) : 0;

  try {
    const res = await fetch('/api/intake/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        mimeType: 'audio/wav',
        language: detectedLanguage.value ?? 'auto',
        history: turns.value,
        elapsedMinutes,
      }),
    });
    const data: IntakeConverseResponse = await res.json();

    if (!res.ok || !data.success) {
      if (data.error) logError('intake:sendVoiceTurn', data.error);
      phase.value = 'idle';
      noticeHtml.value = failureNotice(
        data,
        "Gemini's free-tier quota is exhausted right now, so SabiLine can't understand or respond at the moment. Please try again later.",
        'Something went wrong. Please try again.'
      );
      return;
    }

    if (data.detectedLanguage) detectedLanguage.value = data.detectedLanguage;

    if (!data.transcript) {
      phase.value = 'idle';
      noticeHtml.value = failureNotice(
        data,
        "Gemini's free-tier quota is exhausted right now, so SabiLine can't understand speech at the moment. Please try again later.",
        'Didn&rsquo;t catch that. Try again, or use &ldquo;Prefer to type instead&rdquo; below.'
      );
      return;
    }

    turns.value = [...turns.value, { role: 'user', text: data.transcript }];
    await handleSabiLineReply(data);
  } catch (err) {
    logError('intake:sendVoiceTurn', err);
    phase.value = 'idle';
    noticeHtml.value = 'Something went wrong. Please try again.';
  }
}

async function submitTyped() {
  const val = typedInput.value.trim();
  if (!val) return;
  typedInput.value = '';

  // Nothing to reply to yet if the call hasn't started — treat it the same
  // as tapping SPEAK: connect the call first.
  if (!callStarted.value) {
    await startCall();
    return;
  }

  const historyBeforeThisTurn = turns.value;
  turns.value = [...turns.value, { role: 'user', text: val }];
  phase.value = 'thinking';
  noticeHtml.value = null;
  const elapsedMinutes = callStartedAt.value ? Math.round((Date.now() - callStartedAt.value) / 60000) : 0;

  try {
    const res = await fetch('/api/intake/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: val,
        language: detectedLanguage.value ?? 'auto',
        history: historyBeforeThisTurn,
        elapsedMinutes,
      }),
    });
    const data: IntakeConverseResponse = await res.json();

    if (!res.ok || !data.success) {
      if (data.error) logError('intake:submitTyped', data.error);
      phase.value = 'idle';
      noticeHtml.value = failureNotice(
        data,
        "Gemini's free-tier quota is exhausted right now, so SabiLine can't understand or respond at the moment. Please try again later.",
        'Something went wrong. Please try again.'
      );
      return;
    }

    if (data.detectedLanguage) detectedLanguage.value = data.detectedLanguage;
    await handleSabiLineReply(data);
  } catch (err) {
    logError('intake:submitTyped', err);
    phase.value = 'idle';
    noticeHtml.value = 'Something went wrong. Please try again.';
  }
}

function generateReferenceNumber(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function finalizeVisit(reviewNeeded: boolean) {
  needsManualReview.value = reviewNeeded;

  const record: IntakeRecord = {
    id: `INTAKE-${Date.now()}`,
    referenceNumber: generateReferenceNumber(),
    createdAt: new Date().toISOString(),
    language: detectedLanguage.value ?? 'en',
    conversation: turns.value,
    fields: fields.value,
    department: department.value,
    appointmentSlot: appointmentSlot.value,
    needsManualReview: reviewNeeded,
    primaryAsrProviderId: null,
    status: 'queued_for_review',
  };

  finalRecord.value = record;
  queue.value = [record, ...queue.value];
  saveQueue();
  phase.value = 'complete';
}

async function sendReminderCall(record: IntakeRecord) {
  if (!record.fields.phoneNumber) return;

  reminderStatus.value = { ...reminderStatus.value, [record.id]: { state: 'sending' } };

  try {
    const res = await fetch('/api/intake/remind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: record.fields.phoneNumber,
        department: record.department,
        appointmentSlot: record.appointmentSlot,
      }),
    });
    const data = await res.json();

    if (data.notConfigured) {
      reminderStatus.value = { ...reminderStatus.value, [record.id]: { state: 'not_configured', message: data.error } };
    } else if (data.success) {
      reminderStatus.value = { ...reminderStatus.value, [record.id]: { state: 'sent' } };
    } else {
      reminderStatus.value = { ...reminderStatus.value, [record.id]: { state: 'error', message: data.error } };
    }
  } catch (err) {
    logError('intake:sendReminderCall', err);
    reminderStatus.value = { ...reminderStatus.value, [record.id]: { state: 'error', message: 'Could not reach the reminder-call service.' } };
  }
}

async function handleSpeakClick() {
  if (speakDisabled.value) return;
  if (!callStarted.value) {
    await startCall();
    return;
  }
  await startRecording();
}
</script>

<template>
  <div class="sabiline-intake">
    <div class="app">
      <header class="top">
        <div class="brand">
          <span class="word">SabiLine</span>
          <span class="tag">Voice Intake</span>
        </div>
        <nav class="tabs" role="tablist" aria-label="Views">
          <button role="tab" :aria-selected="activeView === 'speak'" @click="activeView = 'speak'">Speak</button>
          <button role="tab" :aria-selected="activeView === 'visits'" @click="activeView = 'visits'">My Visits</button>
        </nav>
      </header>

      <!-- SPEAK VIEW -->
      <section class="view" :class="{ active: activeView === 'speak' }">
        <div class="speak-stage">
          <div class="speak-btn-wrap">
            <canvas ref="waveCanvas" width="176" height="176"></canvas>
            <button class="speak-btn" :class="speakBtnStateClass" :disabled="speakDisabled" @click="handleSpeakClick">
              <Mic class="icon" />
              <span>{{ speakBtnLabel }}</span>
            </button>
          </div>
          <div class="stage-status">{{ stageStatus }}</div>
          <p class="caption">{{ caption }}</p>
          <span v-if="detectedLanguage" class="pill" aria-pressed="true">
            Detected language: {{ LANGUAGE_LABEL[detectedLanguage] || detectedLanguage }}
          </span>

          <div class="type-row" :class="{ active: showTypeRow }">
            <input
              v-model="typedInput"
              type="text"
              placeholder="Type your reply instead…"
              aria-label="Type your reply"
              @keydown.enter="submitTyped"
            />
            <button class="btn" @click="submitTyped">Send</button>
          </div>
          <button class="type-toggle" @click="showTypeRow = !showTypeRow">Prefer to type instead of talk?</button>

          <div v-if="noticeHtml" class="notice" v-html="noticeHtml"></div>
        </div>

        <div class="speak-stage transcript-stage">
          <div class="transcript">
            <p v-if="turns.length === 0" class="transcript-empty">Your conversation will appear here as you talk.</p>
            <div v-for="(turn, idx) in turns" :key="idx" class="bubble" :class="turn.role === 'model' ? 'bot' : 'patient'">
              <span class="who">{{ turn.role === 'model' ? 'SabiLine' : 'You' }}</span>{{ turn.text }}
            </div>
          </div>
        </div>

        <button v-if="phase === 'complete'" class="btn ghost reset-btn" @click="resetForNewCall">Start a new call</button>
      </section>

      <!-- VISITS VIEW -->
      <section class="view" :class="{ active: activeView === 'visits' }">
        <div v-if="queue.length === 0" class="empty-state">
          <ClipboardList class="icon" />
          <div>No visits yet.</div>
          <div class="sub">Start a call with SabiLine to see your intake summary here.</div>
        </div>

        <div v-else class="visits-list">
          <div v-for="record in queue" :key="record.id" class="visit-card">
            <div class="visit-head">
              <div>
                <div class="name">{{ record.fields.name || 'Unnamed patient' }}</div>
                <div class="when">
                  {{ new Date(record.createdAt).toLocaleString() }} · {{ LANGUAGE_LABEL[record.language] || record.language }}
                </div>
              </div>
              <span class="ref-chip">#{{ record.referenceNumber }}</span>
            </div>

            <dl class="fact-grid">
              <div v-for="(label, key) in INTAKE_FIELD_LABELS" :key="key" class="fact">
                <dt>{{ label }}</dt>
                <dd>{{ record.fields[key] || 'Not captured' }}</dd>
              </div>
            </dl>

            <div v-if="record.needsManualReview" class="review-flag">Flagged for front desk review</div>

            <div v-if="record.department || record.appointmentSlot" class="appt-strip">
              <span class="dept">{{ record.department || 'Department not yet assigned' }}</span>
              <span v-if="record.appointmentSlot" class="time">{{ record.appointmentSlot }}</span>
            </div>

            <div v-if="record.fields.phoneNumber" class="reminder-row">
              <button
                class="type-toggle"
                :disabled="reminderStatus[record.id]?.state === 'sending'"
                @click="sendReminderCall(record)"
              >
                <PhoneCall class="icon-inline" />
                {{ reminderStatus[record.id]?.state === 'sending' ? 'Calling…' : 'Send reminder call' }}
              </button>
              <span v-if="reminderStatus[record.id]?.state === 'sent'" class="reminder-note ok">Call placed</span>
              <span v-if="reminderStatus[record.id]?.state === 'not_configured'" class="reminder-note">
                Twilio isn&rsquo;t configured on this deployment
              </span>
              <span v-if="reminderStatus[record.id]?.state === 'error'" class="reminder-note error">
                {{ reminderStatus[record.id]?.message || 'Call failed' }}
              </span>
            </div>

            <details class="transcript-toggle">
              <summary>View conversation transcript</summary>
              <div class="transcript">
                <div v-for="(turn, idx) in record.conversation" :key="idx" class="bubble" :class="turn.role === 'model' ? 'bot' : 'patient'">
                  <span class="who">{{ turn.role === 'model' ? 'SabiLine' : 'You' }}</span>{{ turn.text }}
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sabiline-intake {
  --ground: #fbfaf7;
  --surface: #ffffff;
  --surface-2: #f5eeda;
  --ink: #26200f;
  --ink-muted: #6e6248;
  --ink-faint: #a89a76;
  --accent: #96721a;
  --accent-strong: #7a5c14;
  --accent-soft: #f6ecd2;
  --on-accent: #ffffff;
  --gold: #b8860b;
  --gold-soft: #fbf1d9;
  --border: #e7ddc2;
  --danger: #a4374a;
  --shadow: 0 1px 2px rgba(33, 28, 46, 0.06), 0 8px 24px -12px rgba(33, 28, 46, 0.18);
  --radius-lg: 28px;
  --radius-md: 16px;
  --radius-sm: 10px;
  --font-display: 'Fraunces', 'Iowan Old Style', ui-serif, Georgia, serif;
  --font-body: 'Work Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;

  display: block;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
}

@media (prefers-color-scheme: dark) {
  .sabiline-intake {
    --ground: #1c170d;
    --surface: #241d10;
    --surface-2: #2e2513;
    --ink: #f7f0dc;
    --ink-muted: #c2b28c;
    --ink-faint: #8a7d5f;
    --accent: #d9b354;
    --accent-strong: #eecb74;
    --accent-soft: #3a2f16;
    --on-accent: #241d10;
    --gold: #e0b15c;
    --gold-soft: #3a2e1a;
    --border: #3d3319;
    --danger: #e08a97;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 28px -14px rgba(0, 0, 0, 0.6);
  }
}

.sabiline-intake * {
  box-sizing: border-box;
}
.sabiline-intake h1,
.sabiline-intake h2,
.sabiline-intake h3 {
  font-family: var(--font-display);
  margin: 0;
}
.sabiline-intake button {
  font-family: inherit;
}

.app {
  width: 100%;
  padding-block: 12px 32px;
  padding-inline: clamp(16px, 4vw, 64px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* The page shell (header, background) fills the full browser width; the
   actual call UI and visit cards stay at a comfortably readable width and
   center within it — a phone-call-sized dialog stretched edge-to-edge on a
   wide monitor would be harder to use, not easier. */
header.top {
  width: 100%;
  max-width: 1100px;
  margin-inline: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-block: 6px 4px;
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.brand .word {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.15rem;
  letter-spacing: 0.01em;
}
.brand .tag {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  color: var(--ink-muted);
}

nav.tabs {
  display: flex;
  gap: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px;
}
nav.tabs button {
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-size: 0.82rem;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
nav.tabs button[aria-selected='true'] {
  background: var(--accent);
  color: white;
}

.pill {
  display: inline-block;
  border: 1px solid var(--border);
  background: var(--accent-soft);
  color: var(--accent-strong);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
}

section.view {
  display: none;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
}
section.view.active {
  display: flex;
}

.speak-stage {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 32px 24px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}
.transcript-stage {
  padding-top: 18px;
  padding-bottom: 14px;
}

.speak-btn-wrap {
  position: relative;
  width: 176px;
  height: 176px;
  display: grid;
  place-items: center;
}
.speak-btn-wrap canvas {
  position: absolute;
  inset: 0;
  width: 176px;
  height: 176px;
  pointer-events: none;
}
.speak-btn {
  position: relative;
  z-index: 2;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--accent);
  color: var(--on-accent);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.02rem;
  letter-spacing: 0.03em;
  box-shadow: 0 10px 30px -10px rgba(150, 114, 26, 0.7);
  transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
  animation: sabiline-breathe 3.2s ease-in-out infinite;
}
.speak-btn:hover:not(:disabled) {
  transform: translateY(-2px);
}
.speak-btn .icon {
  width: 30px;
  height: 30px;
}
.speak-btn.listening {
  background: var(--danger);
  animation: none;
}
.speak-btn.busy {
  background: var(--ink-muted);
  animation: none;
  cursor: progress;
}
.speak-btn.speaking {
  background: var(--gold);
  animation: none;
}
.speak-btn:disabled {
  cursor: not-allowed;
}
@keyframes sabiline-breathe {
  0%,
  100% {
    box-shadow: 0 10px 30px -10px rgba(150, 114, 26, 0.7);
  }
  50% {
    box-shadow: 0 14px 38px -8px rgba(150, 114, 26, 0.85);
  }
}
@media (prefers-reduced-motion: reduce) {
  .speak-btn {
    animation: none;
  }
}

.stage-status {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
  font-weight: 600;
}
.caption {
  font-size: 1.05rem;
  line-height: 1.5;
  max-width: 46ch;
  min-height: 1.6em;
}
.type-toggle {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.type-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.type-row {
  display: none;
  gap: 8px;
  width: 100%;
  max-width: 420px;
}
.type-row.active {
  display: flex;
}
.type-row input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--ground);
  color: var(--ink);
  font-size: 0.92rem;
}
.btn {
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
  background: var(--accent);
  color: var(--on-accent);
  transition: background 0.15s ease;
}
.btn:hover {
  background: var(--accent-strong);
}
.btn.ghost {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}
.btn.ghost:hover {
  background: var(--accent-soft);
}
.reset-btn {
  align-self: center;
}

.notice {
  font-size: 0.8rem;
  color: var(--ink-muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  text-align: left;
}

.transcript {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 2px;
  width: 100%;
}
.bubble {
  max-width: 82%;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 0.92rem;
  line-height: 1.45;
}
.bubble .who {
  display: block;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  margin-bottom: 3px;
  opacity: 0.7;
}
.bubble.bot {
  align-self: flex-start;
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-bottom-left-radius: 4px;
}
.bubble.patient {
  align-self: flex-end;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-bottom-right-radius: 4px;
}
.transcript-empty {
  color: var(--ink-faint);
  font-size: 0.85rem;
  text-align: center;
  padding: 18px 0;
  width: 100%;
  margin: 0;
}

.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--ink-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.empty-state .icon {
  width: 40px;
  height: 40px;
  color: var(--ink-faint);
}
.empty-state .sub {
  font-size: 0.82rem;
}

.visits-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.visit-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.visit-head {
  padding: 16px 18px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.visit-head .name {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
}
.visit-head .when {
  font-size: 0.74rem;
  color: var(--ink-faint);
  font-family: var(--font-mono);
}
.ref-chip {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  background: var(--gold-soft);
  color: var(--gold);
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 600;
  white-space: nowrap;
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  padding: 0 18px 16px;
  margin: 0;
}
.fact dt {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  margin-bottom: 2px;
}
.fact dd {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 500;
}

.review-flag {
  margin: 0 18px 12px;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--danger);
}

.appt-strip {
  margin: 0 18px 16px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--gold-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.appt-strip .dept {
  font-weight: 600;
  color: var(--ink);
}
.appt-strip .time {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--gold);
  font-weight: 600;
}

.reminder-row {
  margin: 0 18px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.icon-inline {
  width: 14px;
  height: 14px;
  display: inline;
  vertical-align: -2px;
  margin-right: 2px;
}
.reminder-note {
  font-size: 0.78rem;
  color: var(--ink-muted);
}
.reminder-note.ok {
  color: var(--accent-strong);
}
.reminder-note.error {
  color: var(--danger);
}

details.transcript-toggle {
  border-top: 1px solid var(--border);
  padding: 10px 18px 16px;
}
details.transcript-toggle summary {
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
}
details.transcript-toggle .transcript {
  margin-top: 10px;
  max-height: 240px;
}

@media (max-width: 480px) {
  .speak-stage {
    padding: 26px 16px 22px;
  }
  .bubble {
    max-width: 90%;
  }
}
</style>
