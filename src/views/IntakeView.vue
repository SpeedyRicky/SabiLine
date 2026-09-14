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
  Pencil,
} from 'lucide-vue-next';
import { LANGUAGES, type LanguageCode } from '../types';
import { catalogLabel } from '../services/asr/catalog';
import { blobToWavBase64, pickRecorderMimeType } from '../services/audio/wavEncoder';
import { speakAloud } from '../services/tts/speakAloud';
import {
  INTAKE_CONFIDENCE_THRESHOLD,
  INTAKE_FIELD_LABELS,
  type IntakeFields,
  type IntakeRecord,
  type IntakeTranscribeResponse,
  type IntakeExtractionResponse,
} from '../services/intake/types';
import { logError } from '../utils/diagnostics';

type Phase =
  | 'idle'
  | 'requesting_mic'
  | 'recording'
  | 'transcribing'
  | 'extracting'
  | 'reveal'
  | 'confirming'
  | 'complete'
  | 'error';

const QUEUE_STORAGE_KEY = 'afrivoice_intake_queue';
const INTAKE_LANGUAGE_CODES: LanguageCode[] = ['en', 'yo', 'ig', 'ha', 'pcm'];
const INTAKE_LANGUAGES = LANGUAGES.filter((l) => INTAKE_LANGUAGE_CODES.includes(l.code));

const EMPTY_FIELDS: IntakeFields = {
  name: null,
  ageOrDob: null,
  paymentType: null,
  reasonForVisit: null,
  symptomDuration: null,
  allergies: null,
};

const selectedLanguage = ref<LanguageCode>('en');
const phase = ref<Phase>('idle');
const turnIndex = ref(0); // 0 = first turn, 1 = follow-up turn
const errorMessage = ref<string | null>(null);
const showDebugPanel = ref(false);

const transcriptTurns = ref<string[]>([]);
const editableFields = ref<IntakeFields>({ ...EMPTY_FIELDS });
const confidencePerField = ref<Record<string, number>>({});
const overallConfidence = ref<number | null>(null);
const followUpQuestion = ref<string | null>(null);
const primaryAsrProviderId = ref<string | null>(null);
const asrAttempts = ref<IntakeTranscribeResponse['attempts']>({});
const gainNormalizationApplied = ref(false);
const lastSpeechFallback = ref<string | null>(null);

const finalRecord = ref<IntakeRecord | null>(null);
const queue = ref<IntakeRecord[]>([]);

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

const confidencePercent = computed(() =>
  overallConfidence.value === null ? null : Math.round(overallConfidence.value * 100)
);

const currentTranscript = computed(() => transcriptTurns.value[transcriptTurns.value.length - 1] ?? '');

const hasExtraction = computed(() => Object.keys(confidencePerField.value).length > 0);

function fieldIsLowConfidence(key: keyof IntakeFields): boolean {
  const c = confidencePerField.value[key];
  return c === undefined || c < INTAKE_CONFIDENCE_THRESHOLD;
}

function resetForNewIntake() {
  phase.value = 'idle';
  turnIndex.value = 0;
  errorMessage.value = null;
  transcriptTurns.value = [];
  editableFields.value = { ...EMPTY_FIELDS };
  confidencePerField.value = {};
  overallConfidence.value = null;
  followUpQuestion.value = null;
  primaryAsrProviderId.value = null;
  asrAttempts.value = {};
  gainNormalizationApplied.value = false;
  lastSpeechFallback.value = null;
  finalRecord.value = null;
}

async function startRecording() {
  errorMessage.value = null;
  phase.value = 'requesting_mic';

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
  phase.value = 'transcribing';

  try {
    const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'audio/webm' });
    if (blob.size === 0) {
      throw new Error('No audio was captured. Please try recording again.');
    }

    const audioBase64 = await blobToWavBase64(blob);
    await processTurn(audioBase64);
  } catch (err) {
    logError('intake:processRecording', err);
    phase.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : 'Could not process the recording. Please try again.';
  }
}

async function processTurn(audioBase64: string) {
  const transcribeRes = await fetch('/api/intake/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType: 'audio/wav', language: selectedLanguage.value }),
  });
  const transcribeData: IntakeTranscribeResponse = await transcribeRes.json();

  if (!transcribeRes.ok || !transcribeData.success) {
    phase.value = 'error';
    errorMessage.value = transcribeData.error || 'Transcription failed.';
    return;
  }

  asrAttempts.value = transcribeData.attempts;
  primaryAsrProviderId.value = transcribeData.primaryProviderId;
  gainNormalizationApplied.value = Boolean(transcribeData.gainNormalizationApplied);

  if (!transcribeData.primaryTranscript) {
    phase.value = 'error';
    errorMessage.value =
      "Sorry, none of the configured speech models could make out what was said. Please try speaking again, closer to the microphone.";
    return;
  }

  transcriptTurns.value = [...transcriptTurns.value, transcribeData.primaryTranscript];
  phase.value = 'extracting';

  const extractRes = await fetch('/api/intake/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: transcribeData.primaryTranscript,
      language: selectedLanguage.value,
      previousFields: turnIndex.value > 0 ? editableFields.value : undefined,
    }),
  });
  const extractData: IntakeExtractionResponse = await extractRes.json();

  if (!extractRes.ok || !extractData.success) {
    phase.value = 'error';
    errorMessage.value = extractData.error || 'Could not process what was said. Please try again.';
    return;
  }

  editableFields.value = extractData.fields ?? { ...EMPTY_FIELDS };
  overallConfidence.value = extractData.overallConfidence ?? 0;
  confidencePerField.value = extractData.confidencePerField ?? {};
  followUpQuestion.value = extractData.followUpQuestion ?? null;
  phase.value = 'reveal';

  const isConfident = (extractData.overallConfidence ?? 0) >= INTAKE_CONFIDENCE_THRESHOLD;

  if (turnIndex.value === 0 && !isConfident && followUpQuestion.value) {
    await askFollowUp(followUpQuestion.value);
  } else {
    await finalizeIntake();
  }
}

async function askFollowUp(question: string) {
  phase.value = 'confirming';
  turnIndex.value = 1;
  const outcome = await speakAloud(question, selectedLanguage.value);
  lastSpeechFallback.value = outcome.usedProvider === 'browser' ? outcome.fallbackReason ?? null : null;
  // The mic re-activates automatically for the patient's answer — no extra
  // tap required, so the follow-up loop reads as one continuous exchange.
  await startRecording();
}

function generateReferenceNumber(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function finalizeIntake() {
  const needsManualReview = (overallConfidence.value ?? 0) < INTAKE_CONFIDENCE_THRESHOLD;
  const f = editableFields.value;

  const parts: string[] = ['Got it.'];
  if (f.reasonForVisit && f.paymentType) {
    parts.push(`I've logged your visit for ${f.reasonForVisit}, ${paymentPhrasing(f.paymentType)}.`);
  } else if (f.reasonForVisit) {
    parts.push(`I've logged your visit for ${f.reasonForVisit}.`);
  }
  parts.push(
    needsManualReview
      ? 'A staff member will review your details shortly.'
      : 'A staff member will confirm shortly.'
  );
  const confirmationText = parts.join(' ');

  phase.value = 'confirming';
  const outcome = await speakAloud(confirmationText, selectedLanguage.value);
  lastSpeechFallback.value = outcome.usedProvider === 'browser' ? outcome.fallbackReason ?? null : null;

  const record: IntakeRecord = {
    id: `INTAKE-${Date.now()}`,
    referenceNumber: generateReferenceNumber(),
    createdAt: new Date().toISOString(),
    language: selectedLanguage.value,
    transcriptTurns: transcriptTurns.value,
    fields: f,
    overallConfidence: overallConfidence.value ?? 0,
    followUpUsed: turnIndex.value > 0,
    needsManualReview,
    primaryAsrProviderId: primaryAsrProviderId.value,
    status: 'queued_for_review',
  };

  finalRecord.value = record;
  queue.value = [record, ...queue.value];
  saveQueue();
  phase.value = 'complete';
}

function paymentPhrasing(paymentType: string): string {
  const lower = paymentType.toLowerCase();
  if (lower.includes('insur') || lower.includes('nhis')) return `paying through ${paymentType}`;
  if (lower.includes('cash') || lower.includes('pocket')) return 'paying out of pocket';
  return `paying via ${paymentType}`;
}

function clearQueue() {
  if (window.confirm('Clear all queued front-desk intake records?')) {
    queue.value = [];
    saveQueue();
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
        Tap to speak — English, Yoruba, Igbo, Hausa, or Pidgin.
      </p>
    </div>

    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div class="flex items-center justify-center gap-3 flex-wrap">
        <label class="text-xs font-medium text-slate-600">
          Language
          <select
            v-model="selectedLanguage"
            :disabled="phase !== 'idle' && phase !== 'error'"
            class="ml-2 border border-slate-300 rounded-md text-sm px-2 py-1"
          >
            <option v-for="lang in INTAKE_LANGUAGES" :key="lang.code" :value="lang.code">{{ lang.flag }} {{ lang.name }}</option>
          </select>
        </label>
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
          <template v-if="phase === 'idle'">{{ turnIndex === 0 ? 'Tap to speak' : 'Tap to answer' }}</template>
          <template v-else-if="phase === 'requesting_mic'">Requesting microphone access…</template>
          <template v-else-if="phase === 'recording'">Listening…</template>
          <template v-else-if="phase === 'transcribing'">Understanding your speech…</template>
          <template v-else-if="phase === 'extracting'">
            {{ primaryAsrProviderId ? `Understood via ${catalogLabel(primaryAsrProviderId)} — extracting details…` : 'Extracting details…' }}
          </template>
          <template v-else-if="phase === 'confirming'">
            <Volume2 class="w-4 h-4 inline -mt-0.5" /> Speaking…
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

    <!-- Transcript + structured record -->
    <div v-if="hasExtraction" class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div>
        <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Transcript</h2>
        <p class="text-sm text-slate-800 italic">"{{ currentTranscript }}"</p>
      </div>

      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-800">
          {{ phase === 'complete' ? 'Intake submitted' : 'Extracted so far' }}
        </h2>
        <span
          v-if="confidencePercent !== null"
          class="text-xs font-medium px-2 py-0.5 rounded-full"
          :class="confidencePercent >= 70 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
        >
          Confidence {{ confidencePercent }}%
        </span>
      </div>

      <div v-if="phase === 'complete'" class="text-center py-2">
        <div class="text-emerald-700 text-2xl font-bold flex items-center justify-center gap-2">
          <CheckCircle2 class="w-6 h-6" /> Reference #{{ finalRecord?.referenceNumber }}
        </div>
        <p class="text-xs text-slate-500 mt-1">
          {{ finalRecord?.needsManualReview ? 'Flagged for front desk review — some details need confirming.' : 'Queued for front desk review.' }}
        </p>
      </div>

      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div
          v-for="(label, key, idx) in INTAKE_FIELD_LABELS"
          :key="key"
          class="intake-field-reveal"
          :style="{ animationDelay: `${idx * 90}ms` }"
        >
          <dt class="text-xs text-slate-500 flex items-center gap-1">
            {{ label }}
            <Pencil v-if="fieldIsLowConfidence(key) && phase !== 'complete' && editableFields[key]" class="w-3 h-3 text-amber-600" />
          </dt>
          <dd>
            <input
              v-if="fieldIsLowConfidence(key) && phase !== 'complete'"
              v-model="editableFields[key]"
              type="text"
              placeholder="Not captured — tap to add"
              class="w-full text-sm font-medium px-2 py-1 rounded border bg-amber-50 border-amber-300 text-slate-900 placeholder:text-amber-600 placeholder:italic focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <span v-else class="font-medium" :class="editableFields[key] ? 'text-slate-900' : 'text-slate-400 italic'">
              {{ editableFields[key] || 'Not captured' }}
            </span>
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
    <div v-if="Object.keys(asrAttempts).length > 0" class="bg-white border border-slate-200 rounded-xl p-4">
      <button
        class="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
        @click="showDebugPanel = !showDebugPanel"
      >
        <span>Judge debug: model outputs for this clip</span>
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
          <div v-if="id === primaryAsrProviderId" class="mt-0.5 font-semibold">Used for this intake</div>
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
        <li v-for="record in queue" :key="record.id" class="py-2.5 flex items-center justify-between text-sm gap-2">
          <div>
            <span class="font-mono text-xs text-slate-400">#{{ record.referenceNumber }}</span>
            <span class="font-medium text-slate-900 ml-2">{{ record.fields.name || 'Unnamed patient' }}</span>
            <span class="text-slate-500"> — {{ record.fields.reasonForVisit || 'reason not captured' }}</span>
          </div>
          <span
            v-if="record.needsManualReview"
            class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0"
          >
            Needs review
          </span>
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
