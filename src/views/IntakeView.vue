<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  RefreshCw,
  Volume2,
  ChevronDown,
  ChevronUp,
  PhoneCall,
} from 'lucide-vue-next';
import { LANGUAGES, type LanguageCode } from '../types';
import { catalogLabel } from '../services/asr/catalog';
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

type Phase = 'idle' | 'requesting_mic' | 'recording' | 'thinking' | 'speaking' | 'complete' | 'error';

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

const phase = ref<Phase>('idle');
const detectedLanguage = ref<LanguageCode | null>(null);
const callStartedAt = ref<number | null>(null);
const errorMessage = ref<string | null>(null);
const showDebugPanel = ref(false);

const turns = ref<IntakeConversationTurn[]>([]);
const fields = ref<IntakeFields>({ ...EMPTY_FIELDS });
const department = ref<string | null>(null);
const appointmentSlot = ref<string | null>(null);
const needsManualReview = ref(false);
const primaryAsrProviderId = ref<string | null>(null);
const asrAttempts = ref<IntakeConverseResponse['attempts']>({});
const gainNormalizationApplied = ref(false);
const lastSpeechFallback = ref<string | null>(null);

const finalRecord = ref<IntakeRecord | null>(null);
const queue = ref<IntakeRecord[]>([]);

type ReminderState = 'sending' | 'sent' | 'not_configured' | 'error';
const reminderStatus = ref<Record<string, { state: ReminderState; message?: string }>>({});

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let activeStream: MediaStream | null = null;

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

const hasStarted = computed(() => turns.value.length > 0);

function resetForNewIntake() {
  phase.value = 'idle';
  detectedLanguage.value = null;
  callStartedAt.value = null;
  errorMessage.value = null;
  turns.value = [];
  fields.value = { ...EMPTY_FIELDS };
  department.value = null;
  appointmentSlot.value = null;
  needsManualReview.value = false;
  primaryAsrProviderId.value = null;
  asrAttempts.value = {};
  gainNormalizationApplied.value = false;
  lastSpeechFallback.value = null;
  finalRecord.value = null;
}

async function startRecording() {
  errorMessage.value = null;
  phase.value = 'requesting_mic';
  if (callStartedAt.value === null) callStartedAt.value = Date.now();

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    logError('intake:getUserMedia', err);
    phase.value = 'error';
    errorMessage.value =
      err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone access was denied. Please allow microphone access in your browser to use voice intake.'
        : 'Could not access your microphone. Please check your device settings and try again.';
    return;
  }

  recordedChunks = [];
  const mimeType = pickRecorderMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = null;
    void handleRecordingStopped();
  };

  mediaRecorder.start();
  phase.value = 'recording';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

async function handleRecordingStopped() {
  phase.value = 'thinking';

  try {
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'audio/webm' });
    if (blob.size === 0) {
      throw new Error('No audio was captured. Please try recording again.');
    }

    const audioBase64 = await blobToWavBase64(blob);
    await sendTurn(audioBase64);
  } catch (err) {
    logError('intake:processRecording', err);
    phase.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : 'Could not process the recording. Please try again.';
  }
}

function generateReferenceNumber(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function sendTurn(audioBase64: string) {
  const elapsedMinutes = callStartedAt.value ? Math.round((Date.now() - callStartedAt.value) / 60000) : 0;

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
    phase.value = 'error';
    errorMessage.value = data.quotaExceeded
      ? "Gemini's free-tier quota is exhausted right now, so SabiLine can't understand or respond at the moment. Please try again later, or enable billing on the Gemini API key."
      : data.error || 'Something went wrong. Please try again.';
    return;
  }

  if (data.detectedLanguage) detectedLanguage.value = data.detectedLanguage;
  asrAttempts.value = data.attempts ?? {};
  primaryAsrProviderId.value = data.primaryProviderId ?? null;
  gainNormalizationApplied.value = Boolean(data.gainNormalizationApplied);

  if (!data.transcript) {
    phase.value = 'error';
    errorMessage.value = data.quotaExceeded
      ? "Gemini's free-tier quota is exhausted right now, so SabiLine can't understand speech at the moment. Please try again later, or enable billing on the Gemini API key."
      : "Sorry, none of the configured speech models could make out what was said. Please try again, closer to the microphone.";
    return;
  }

  turns.value = [...turns.value, { role: 'user', text: data.transcript }];

  if (!data.spokenReply) {
    phase.value = 'error';
    errorMessage.value = 'SabiLine had nothing to say back — please try again.';
    return;
  }

  turns.value = [...turns.value, { role: 'model', text: data.spokenReply }];
  if (data.fields) fields.value = { ...EMPTY_FIELDS, ...data.fields };
  if (data.department !== undefined) department.value = data.department;
  if (data.appointmentSlot !== undefined) appointmentSlot.value = data.appointmentSlot;

  phase.value = 'speaking';
  const outcome = await speakAloud(data.spokenReply, detectedLanguage.value ?? 'en');
  lastSpeechFallback.value = outcome.usedProvider === 'browser' ? outcome.fallbackReason ?? null : null;

  if (data.done) {
    finalizeIntake(Boolean(data.needsManualReview));
  } else {
    // The mic re-activates automatically for the patient's next reply — no
    // extra tap required, so the conversation reads as one continuous call.
    await startRecording();
  }
}

function finalizeIntake(reviewNeeded: boolean) {
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
    primaryAsrProviderId: primaryAsrProviderId.value,
    status: 'queued_for_review',
  };

  finalRecord.value = record;
  queue.value = [record, ...queue.value];
  saveQueue();
  phase.value = 'complete';
}

function clearQueue() {
  if (window.confirm('Clear all queued front-desk intake records?')) {
    queue.value = [];
    saveQueue();
  }
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
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div class="text-center sm:text-left">
      <h1 class="text-xl font-bold text-slate-900 flex items-center justify-center sm:justify-start gap-2">
        <ClipboardList class="w-5 h-5 text-emerald-700" />
        SabiLine Patient Intake
      </h1>
      <p class="text-sm text-slate-600 mt-1">
        Tap to speak in English, Yoruba, Igbo, Hausa, Fulfulde, or Pidgin — no need to pick one, and no fixed
        script: SabiLine responds to whatever you actually say.
      </p>
    </div>

    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div v-if="detectedLanguage" class="flex items-center justify-center">
        <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
          Detected language: {{ LANGUAGE_LABEL[detectedLanguage] || detectedLanguage }}
        </span>
      </div>

      <!-- Mic control -->
      <div class="flex flex-col items-center justify-center py-6 gap-3">
        <button
          v-if="phase === 'idle' || phase === 'error'"
          id="intake-mic-button"
          class="w-24 h-24 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center shadow-lg transition-colors"
          @click="startRecording"
        >
          <Mic class="w-9 h-9" />
        </button>

        <button
          v-else-if="phase === 'recording'"
          id="intake-stop-button"
          class="w-24 h-24 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg animate-pulse"
          @click="stopRecording"
        >
          <Square class="w-8 h-8" />
        </button>

        <div v-else class="w-24 h-24 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
          <Loader2 class="w-9 h-9 animate-spin" />
        </div>

        <p class="text-sm text-slate-700 font-medium">
          <template v-if="phase === 'idle'">{{ hasStarted ? 'Tap to reply' : 'Tap to speak' }}</template>
          <template v-else-if="phase === 'requesting_mic'">Requesting microphone access…</template>
          <template v-else-if="phase === 'recording'">Listening…</template>
          <template v-else-if="phase === 'thinking'">
            {{ primaryAsrProviderId ? `Understanding via ${catalogLabel(primaryAsrProviderId)}…` : 'Understanding…' }}
          </template>
          <template v-else-if="phase === 'speaking'">
            <Volume2 class="w-4 h-4 inline -mt-0.5" /> SabiLine is speaking…
          </template>
          <template v-else-if="phase === 'error'">Ready to try again</template>
        </p>
        <p v-if="phase === 'recording'" class="text-xs text-slate-400">Tap the button again to stop</p>

        <p v-if="lastSpeechFallback" class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Gemini voice quota reached — spoke via device voice instead.
        </p>
      </div>

      <div v-if="errorMessage" class="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
        <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>
    </div>

    <!-- Conversation transcript -->
    <div v-if="hasStarted" class="bg-white border border-slate-200 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Conversation</h2>
      <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1">
        <div
          v-for="(turn, idx) in turns"
          :key="idx"
          class="max-w-[85%] px-3.5 py-2 rounded-2xl text-sm leading-snug"
          :class="turn.role === 'model'
            ? 'self-start bg-emerald-50 text-emerald-900 rounded-bl-sm'
            : 'self-end bg-slate-100 text-slate-800 rounded-br-sm'"
        >
          <span class="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
            {{ turn.role === 'model' ? 'SabiLine' : 'You' }}
          </span>
          {{ turn.text }}
        </div>
      </div>
    </div>

    <!-- Live structured record -->
    <div v-if="hasStarted" class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-800">
          {{ phase === 'complete' ? 'Intake submitted' : 'Extracted so far' }}
        </h2>
      </div>

      <div v-if="phase === 'complete'" class="text-center py-2">
        <div class="text-emerald-700 text-2xl font-bold flex items-center justify-center gap-2">
          <CheckCircle2 class="w-6 h-6" /> Reference #{{ finalRecord?.referenceNumber }}
        </div>
        <p class="text-xs text-slate-500 mt-1">
          {{ finalRecord?.needsManualReview ? 'Flagged for front desk review — some details need confirming.' : 'Queued for front desk review.' }}
        </p>
        <p v-if="finalRecord?.department || finalRecord?.appointmentSlot" class="text-sm text-emerald-800 mt-2 font-medium">
          {{ finalRecord?.department || 'Department not yet assigned' }}
          <span v-if="finalRecord?.appointmentSlot"> — {{ finalRecord.appointmentSlot }}</span>
        </p>
      </div>

      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div v-for="(label, key, idx) in INTAKE_FIELD_LABELS" :key="key" class="intake-field-reveal" :style="{ animationDelay: `${idx * 90}ms` }">
          <dt class="text-xs text-slate-500">{{ label }}</dt>
          <dd class="font-medium" :class="fields[key] ? 'text-slate-900' : 'text-slate-400 italic'">
            {{ fields[key] || 'Not captured' }}
          </dd>
        </div>
      </dl>

      <div v-if="phase === 'complete'" class="pt-2 text-center">
        <button
          class="text-sm font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 mx-auto"
          @click="resetForNewIntake"
        >
          <RefreshCw class="w-4 h-4" /> Run another intake
        </button>
      </div>

      <details v-if="phase === 'complete'" class="text-xs text-slate-500">
        <summary class="cursor-pointer select-none">View raw JSON record</summary>
        <pre class="mt-2 p-3 bg-slate-50 rounded-lg overflow-x-auto">{{ JSON.stringify(finalRecord, null, 2) }}</pre>
      </details>
    </div>

    <!-- Judge debug panel: raw per-model outputs, hidden by default -->
    <div v-if="Object.keys(asrAttempts ?? {}).length > 0" class="bg-white border border-slate-200 rounded-xl p-4">
      <button
        class="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
        @click="showDebugPanel = !showDebugPanel"
      >
        <span>Judge debug: model outputs for this turn</span>
        <ChevronDown v-if="!showDebugPanel" class="w-4 h-4" />
        <ChevronUp v-else class="w-4 h-4" />
      </button>

      <div v-if="showDebugPanel" class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <div
          v-for="(attempt, id) in asrAttempts"
          :key="id"
          class="p-2 rounded-lg border text-xs"
          :class="attempt.success
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : attempt.notConfigured
            ? 'bg-slate-50 border-slate-200 text-slate-500'
            : 'bg-rose-50 border-rose-200 text-rose-700'"
        >
          <div class="font-medium">{{ catalogLabel(String(id)) }}</div>
          <div class="mt-0.5">
            {{ attempt.success ? `"${attempt.transcript}"` : attempt.notConfigured ? 'Not configured' : `Failed: ${attempt.error}` }}
          </div>
          <div v-if="id === primaryAsrProviderId" class="mt-0.5 font-semibold">Used for this turn</div>
        </div>
      </div>
      <p v-if="showDebugPanel && gainNormalizationApplied" class="text-[11px] text-slate-500 mt-2">
        Audio was quiet, so it was boosted before transcription.
      </p>
    </div>

    <!-- Front desk queue -->
    <div v-if="queue.length > 0" class="bg-white border border-slate-200 rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-slate-800">Front desk queue ({{ queue.length }})</h2>
        <button class="text-xs text-slate-500 hover:text-rose-600" @click="clearQueue">Clear</button>
      </div>
      <ul class="divide-y divide-slate-100">
        <li v-for="record in queue" :key="record.id" class="py-2.5 flex flex-col gap-1.5 text-sm">
          <div class="flex items-center justify-between gap-2">
            <div>
              <span class="font-mono text-xs text-slate-400">#{{ record.referenceNumber }}</span>
              <span class="font-medium text-slate-900 ml-2">{{ record.fields.name || 'Unnamed patient' }}</span>
              <span class="text-slate-500"> — {{ record.fields.reasonForVisit || 'reason not captured' }}</span>
              <span v-if="record.appointmentSlot" class="text-emerald-700"> · {{ record.department }} {{ record.appointmentSlot }}</span>
            </div>
            <span
              v-if="record.needsManualReview"
              class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0"
            >
              Needs review
            </span>
          </div>

          <div v-if="record.fields.phoneNumber" class="flex items-center gap-2">
            <button
              class="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="reminderStatus[record.id]?.state === 'sending'"
              @click="sendReminderCall(record)"
            >
              <PhoneCall class="w-3.5 h-3.5" />
              {{ reminderStatus[record.id]?.state === 'sending' ? 'Calling…' : 'Send reminder call' }}
            </button>
            <span v-if="reminderStatus[record.id]?.state === 'sent'" class="text-xs text-emerald-700">Call placed</span>
            <span v-if="reminderStatus[record.id]?.state === 'not_configured'" class="text-xs text-amber-700">
              Twilio isn't configured on this deployment
            </span>
            <span v-if="reminderStatus[record.id]?.state === 'error'" class="text-xs text-rose-700">
              {{ reminderStatus[record.id]?.message || 'Call failed' }}
            </span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.intake-field-reveal {
  animation: intake-field-fade-in 260ms ease-out both;
}

@keyframes intake-field-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
