<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  Volume2,
  Globe2,
  Sliders,
  RefreshCw,
  Trash2,
  ArrowRightLeft,
  AlertCircle,
  BookmarkCheck,
  CheckCircle2,
  Languages,
} from 'lucide-vue-next';
import { LANGUAGES, type LanguageCode, type ProviderId, type TTSResult, type SavedResultItem, type ProviderCapability } from '../types';
import { AVAILABLE_VOICES, PROVIDER_CAPABILITIES } from '../services/tts/voices';
import PresetSelector from '../components/PresetSelector.vue';
import type { HealthcarePreset } from '../services/tts/presets';
import AudioWaveformPlayer from '../components/AudioWaveformPlayer.vue';
import ProviderStatusBanner from '../components/ProviderStatusBanner.vue';
import MultiLanguageModal from '../components/MultiLanguageModal.vue';
import CompareAudioModal from '../components/CompareAudioModal.vue';

const props = defineProps<{
  savedResults: SavedResultItem[];
  providers: Record<string, ProviderCapability>;
}>();

const emit = defineEmits<{
  (e: 'saveToLibrary', result: SavedResultItem): void;
}>();

const text = ref(
  'Kina bukatar shan maganin iron da folic acid a kowace rana don karfafa jinin ki da lafiyar jaririn da ke cikin ki.'
);
const selectedLang = ref<LanguageCode>('ha');
const selectedProvider = ref<ProviderId>('openai');
const selectedVoiceId = ref('openai-alloy');
const speed = ref(1.0);
const emotion = ref<'neutral' | 'empathic' | 'authoritative' | 'urgent'>('empathic');

const isGenerating = ref(false);
const lastResult = ref<TTSResult | null>(null);
const previousResult = ref<TTSResult | null>(null);
const errorMessage = ref<string | null>(null);
const saveSuccess = ref(false);

const showMultiLangModal = ref(false);
const showCompareModal = ref(false);

const availableVoicesForSelection = computed(() => AVAILABLE_VOICES.filter((v) => v.language === selectedLang.value));

watch(selectedLang, () => {
  const matchingVoice =
    AVAILABLE_VOICES.find((v) => v.language === selectedLang.value && v.provider === selectedProvider.value) ||
    AVAILABLE_VOICES.find((v) => v.language === selectedLang.value) ||
    AVAILABLE_VOICES[0];

  if (matchingVoice) {
    selectedVoiceId.value = matchingVoice.id;
    selectedProvider.value = matchingVoice.provider;
  }
});

const currentProviderCap = computed(() => PROVIDER_CAPABILITIES[selectedProvider.value]);
const isLanguageSupportedByProvider = computed(() => currentProviderCap.value?.supportedLanguages.includes(selectedLang.value));

const wordCount = computed(() => (text.value.trim() ? text.value.trim().split(/\s+/).length : 0));
const charCount = computed(() => text.value.length);

const activeVoice = computed(() => AVAILABLE_VOICES.find((v) => v.id === selectedVoiceId.value));
const voicesForDropdown = computed(() =>
  AVAILABLE_VOICES.filter((v) => v.language === selectedLang.value || v.provider === 'openai')
);

function handlePresetSelect(preset: HealthcarePreset) {
  text.value = preset.text;
  selectedLang.value = preset.language;
  errorMessage.value = null;
}

function onVoiceChange(e: Event) {
  const vId = (e.target as HTMLSelectElement).value;
  selectedVoiceId.value = vId;
  const voiceObj = AVAILABLE_VOICES.find((v) => v.id === vId);
  if (voiceObj) selectedProvider.value = voiceObj.provider;
}

function synthesizeViaBrowser(note?: string): TTSResult {
  if (!('speechSynthesis' in window)) {
    throw new Error('Web Speech API is not supported by your browser.');
  }

  const utterance = new SpeechSynthesisUtterance(text.value);
  utterance.rate = speed.value;

  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const matchingOsVoice = voices.find((v) => v.lang.startsWith(selectedLang.value));
  if (matchingOsVoice) utterance.voice = matchingOsVoice;

  synth.speak(utterance);

  return {
    id: `TTS-${Date.now()}`,
    text: text.value,
    language: selectedLang.value,
    voiceId: selectedVoiceId.value,
    provider: 'browser',
    mimeType: 'audio/wav',
    durationSec: Math.max(2, Math.round(wordCount.value * 0.4)),
    timestamp: new Date().toISOString(),
    note: note || 'Synthesized via local Device Web Speech',
  };
}

async function handleGenerate() {
  if (!text.value.trim()) {
    errorMessage.value = 'Please enter some text to synthesize.';
    return;
  }

  errorMessage.value = null;
  isGenerating.value = true;
  saveSuccess.value = false;

  try {
    if (selectedProvider.value === 'browser') {
      const dummyResult = synthesizeViaBrowser();
      if (lastResult.value) previousResult.value = lastResult.value;
      lastResult.value = dummyResult;
      isGenerating.value = false;
      return;
    }

    const response = await fetch('/api/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.value,
        language: selectedLang.value,
        voiceId: selectedVoiceId.value,
        provider: selectedProvider.value,
        speed: speed.value,
        emotion: emotion.value,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      // OpenAI's voice quota can run out fast — fall back to device speech
      // automatically instead of leaving the user with a dead-end error.
      if (data.quotaExceeded && selectedProvider.value === 'openai') {
        const fallbackResult = synthesizeViaBrowser(
          `OpenAI's voice quota is exhausted right now, so this was spoken via Device Web Speech instead. (${data.error})`
        );
        if (lastResult.value) previousResult.value = lastResult.value;
        lastResult.value = fallbackResult;
        errorMessage.value = null;
        return;
      }
      throw new Error(data.error || 'Speech generation failed.');
    }

    const newResult: TTSResult = {
      id: `TTS-${Date.now()}`,
      audioBase64: data.audioBase64,
      mimeType: data.mimeType || 'audio/wav',
      durationSec: data.durationSec || 4,
      text: text.value,
      language: selectedLang.value,
      voiceId: selectedVoiceId.value,
      provider: selectedProvider.value,
      timestamp: new Date().toISOString(),
    };

    if (lastResult.value) previousResult.value = lastResult.value;
    lastResult.value = newResult;
  } catch (err) {
    console.error('Generation failure:', err);
    errorMessage.value = err instanceof Error ? err.message : 'An unexpected error occurred during synthesis.';
  } finally {
    isGenerating.value = false;
  }
}

function handleSaveToLibrary() {
  if (!lastResult.value) return;
  const voiceObj = AVAILABLE_VOICES.find((v) => v.id === lastResult.value?.voiceId);
  emit('saveToLibrary', {
    id: lastResult.value.id,
    text: lastResult.value.text,
    language: lastResult.value.language,
    voiceName: voiceObj?.name || lastResult.value.voiceId,
    provider: lastResult.value.provider,
    audioBase64: lastResult.value.audioBase64,
    audioUrl: lastResult.value.audioUrl,
    durationSec: lastResult.value.durationSec,
    createdAt: lastResult.value.timestamp,
  });
  saveSuccess.value = true;
  setTimeout(() => (saveSuccess.value = false), 3000);
}

function handleClear() {
  text.value = '';
  errorMessage.value = null;
}

function toSavedShape(r: TTSResult): SavedResultItem {
  return {
    id: r.id,
    text: r.text,
    language: r.language,
    voiceName: r.voiceId,
    provider: r.provider,
    audioBase64: r.audioBase64,
    audioUrl: r.audioUrl,
    durationSec: r.durationSec,
    createdAt: r.timestamp,
  };
}
</script>

<template>
  <div class="space-y-6 py-2 max-w-6xl mx-auto">
    <ProviderStatusBanner :providers="providers" />

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Volume2 class="w-5 h-5 text-emerald-700" />
          <span>Voice Generator</span>
        </h2>
        <p class="text-xs text-slate-600 mt-0.5">
          Create spoken announcements and audio instructions across African and global languages.
        </p>
      </div>

      <button
        id="open-multi-lang-gen-btn"
        class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium text-xs shadow-2xs transition-colors self-start sm:self-auto"
        @click="showMultiLangModal = true"
      >
        <Globe2 class="w-3.5 h-3.5 text-slate-500" />
        <span>Generate in Multiple Languages</span>
      </button>
    </div>

    <PresetSelector @select="handlePresetSelect" />

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div class="lg:col-span-7 space-y-4">
        <div class="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-500">
            <label for="voice-text-input" class="font-semibold text-slate-800">Text to Speak:</label>
            <div class="flex items-center gap-2 font-mono text-slate-500">
              <span>{{ wordCount }} words</span>
              <span>·</span>
              <span>{{ charCount }} chars</span>
            </div>
          </div>

          <textarea
            id="voice-text-input"
            v-model="text"
            rows="6"
            class="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-colors leading-relaxed"
            placeholder="Enter or paste text for maternal guidance, triage notification, or community health notice..."
          />

          <div class="flex items-center justify-between pt-1">
            <span class="text-[11px] text-slate-500">
              Supports African tonal accents (e.g. Igbo sub-dots ọ, ụ, ị and Yoruba tone marks á, à).
            </span>
            <button type="button" class="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors" @click="handleClear">
              <Trash2 class="w-3.5 h-3.5" />
              <span>Clear text</span>
            </button>
          </div>
        </div>

        <div class="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Languages class="w-4 h-4 text-emerald-700" />
              <span>Select Target Language:</span>
            </label>
            <span class="text-[11px] text-slate-500">Hausa, Igbo, Yoruba & Global</span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="lang in LANGUAGES"
              :key="lang.code"
              :id="`select-lang-${lang.code}`"
              type="button"
              class="p-2.5 rounded-lg border text-left transition-colors relative"
              :class="selectedLang === lang.code
                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 font-semibold ring-1 ring-emerald-600'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'"
              @click="selectedLang = lang.code"
            >
              <div class="flex items-center justify-between">
                <span class="text-base">{{ lang.flag }}</span>
                <span v-if="lang.african" class="text-[9px] uppercase font-semibold px-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  AFR
                </span>
              </div>
              <div class="mt-1 font-semibold text-xs text-slate-900 truncate">{{ lang.name.split(' ')[0] }}</div>
              <div class="text-[10px] text-slate-500 truncate">{{ lang.nativeName }}</div>
            </button>
          </div>
        </div>
      </div>

      <div class="lg:col-span-5 space-y-4">
        <div class="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 shadow-xs text-slate-800 space-y-4">
          <div class="flex items-center justify-between">
            <label for="voice-select-dropdown" class="text-xs font-semibold text-slate-800">Voice & Accent:</label>
            <span class="text-[11px] text-slate-500">{{ availableVoicesForSelection.length }} voices available</span>
          </div>

          <div v-if="!isLanguageSupportedByProvider" class="bg-amber-50 border border-amber-200 p-3 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle class="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <strong class="capitalize">{{ selectedProvider }}</strong> does not officially support
              <strong>{{ LANGUAGES.find((l) => l.code === selectedLang)?.name }}</strong>.
              <div class="mt-0.5 text-amber-800">You can switch to Intron Sahara or standard device speech for this language.</div>
            </div>
          </div>

          <div>
            <select
              id="voice-select-dropdown"
              :value="selectedVoiceId"
              class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:outline-none focus:border-slate-500"
              @change="onVoiceChange"
            >
              <option v-for="voice in voicesForDropdown" :key="voice.id" :value="voice.id">
                {{ voice.name }} · [{{ voice.provider.toUpperCase() }}] ({{ voice.accent }})
              </option>
            </select>

            <div v-if="activeVoice" class="mt-2.5 p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div class="flex items-center justify-between text-[11px] text-slate-500">
                <span>Provider: <strong class="text-slate-800 uppercase">{{ activeVoice.provider }}</strong></span>
                <span>Gender: <strong class="capitalize text-slate-800">{{ activeVoice.gender }}</strong></span>
              </div>
              <p v-if="activeVoice.recommendedFor" class="text-[11px] text-slate-500">Recommendation: {{ activeVoice.recommendedFor }}</p>
            </div>
          </div>

          <div class="space-y-3 pt-3 border-t border-slate-100">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Sliders class="w-3.5 h-3.5 text-slate-500" />
              <span>Speech Rate & Tone:</span>
            </div>

            <div class="space-y-1">
              <div class="flex justify-between text-xs text-slate-600">
                <span>Speaking Rate:</span>
                <span class="font-mono font-medium text-slate-900">{{ speed }}x</span>
              </div>
              <input
                v-model.number="speed"
                type="range"
                min="0.7"
                max="1.5"
                step="0.05"
                class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-emerald-700"
                aria-label="Speaking rate"
              />
            </div>

            <div class="space-y-1">
              <label class="block text-xs text-slate-600">Tone / Emotion:</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="em in ([
                    { id: 'empathic', label: 'Empathetic Counseling' },
                    { id: 'authoritative', label: 'Public Health Notice' },
                    { id: 'urgent', label: 'Urgent Clinical' },
                    { id: 'neutral', label: 'Standard Information' },
                  ] as const)"
                  :key="em.id"
                  type="button"
                  class="px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                  :class="emotion === em.id ? 'bg-slate-100 border-slate-400 text-slate-900 font-semibold' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'"
                  @click="emotion = em.id"
                >
                  {{ em.label }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="errorMessage" class="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle class="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div><strong>Error:</strong> {{ errorMessage }}</div>
          </div>

          <button
            id="generate-voice-btn"
            type="button"
            :disabled="isGenerating || !text.trim()"
            class="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-2xs"
            @click="handleGenerate"
          >
            <template v-if="isGenerating">
              <RefreshCw class="w-4 h-4 animate-spin" />
              <span>Synthesizing Audio...</span>
            </template>
            <template v-else>
              <Volume2 class="w-4 h-4" />
              <span>Generate Speech Audio</span>
            </template>
          </button>
        </div>
      </div>
    </div>

    <div v-if="lastResult" class="bg-white border border-slate-200 rounded-lg p-5 shadow-xs text-slate-800 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <CheckCircle2 class="w-4 h-4 text-emerald-700" />
            <h3 class="text-sm font-bold text-slate-900">Generated Audio Output</h3>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">
            Language: {{ LANGUAGES.find((l) => l.code === lastResult?.language)?.name }} · Provider:
            <span class="capitalize font-semibold text-slate-800">{{ lastResult.provider }}</span>
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="previousResult"
            class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition-colors"
            @click="showCompareModal = true"
          >
            <ArrowRightLeft class="w-3.5 h-3.5 text-slate-500" />
            <span>Compare Audio</span>
          </button>

          <button
            id="save-to-library-btn"
            class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors"
            @click="handleSaveToLibrary"
          >
            <BookmarkCheck class="w-3.5 h-3.5" />
            <span>{{ saveSuccess ? 'Saved to Library' : 'Save to Library' }}</span>
          </button>
        </div>
      </div>

      <AudioWaveformPlayer
        :audio-base64="lastResult.audioBase64"
        :audio-url="lastResult.audioUrl"
        :mime-type="lastResult.mimeType"
        :title="`${LANGUAGES.find((l) => l.code === lastResult?.language)?.name} Speech`"
        :language="lastResult.language"
        :provider="lastResult.provider"
        :duration-sec="lastResult.durationSec"
        :auto-play="true"
      />
    </div>

    <MultiLanguageModal
      v-if="showMultiLangModal"
      :initial-text="text"
      :source-lang="selectedLang"
      @close="showMultiLangModal = false"
      @save-result="(item) => $emit('saveToLibrary', item)"
    />

    <CompareAudioModal
      v-if="showCompareModal && lastResult && previousResult"
      :item-a="toSavedShape(previousResult)"
      :item-b="toSavedShape(lastResult)"
      @close="showCompareModal = false"
    />
  </div>
</template>
