<script setup lang="ts">
import { ref } from 'vue';
import { X, Globe2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-vue-next';
import { LANGUAGES, type LanguageCode, type MultiLanguageResultItem, type ProviderId, type SavedResultItem, type TTSResult } from '../types';
import { AVAILABLE_VOICES, PROVIDER_CAPABILITIES } from '../services/tts/voices';
import AudioWaveformPlayer from './AudioWaveformPlayer.vue';
import { apiUrl } from '../services/api/apiBase';

const props = defineProps<{
  initialText: string;
  sourceLang: LanguageCode;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saveResult', item: SavedResultItem): void;
}>();

const inputText = ref(props.initialText);
const selectedLangs = ref<LanguageCode[]>(['ha', 'yo', 'ig', 'en', 'fr']);
const translateFirst = ref(true);
const isProcessing = ref(false);
const results = ref<MultiLanguageResultItem[]>([]);
const activeStepMessage = ref('');

function toggleLang(code: LanguageCode) {
  if (selectedLangs.value.includes(code)) {
    if (selectedLangs.value.length > 1) {
      selectedLangs.value = selectedLangs.value.filter((l) => l !== code);
    }
  } else {
    selectedLangs.value = [...selectedLangs.value, code];
  }
}

function langName(code: LanguageCode) {
  return LANGUAGES.find((l) => l.code === code);
}

async function executeMultiGeneration() {
  if (!inputText.value.trim()) return;
  isProcessing.value = true;

  const initialItems: MultiLanguageResultItem[] = selectedLangs.value.map((langCode) => {
    const voice =
      AVAILABLE_VOICES.find((v) => v.language === langCode && v.provider === 'sahara') ||
      AVAILABLE_VOICES.find((v) => v.language === langCode) ||
      AVAILABLE_VOICES[0];

    return {
      language: langCode,
      translatedText: langCode === props.sourceLang ? inputText.value : '',
      status: 'pending',
      provider: voice.provider,
      voiceName: voice.name,
    };
  });

  results.value = initialItems;

  for (let i = 0; i < initialItems.length; i++) {
    const item = initialItems[i];
    const info = langName(item.language);
    activeStepMessage.value = `Processing ${info?.name || item.language}...`;

    try {
      let textToSynthesize = inputText.value;

      if (translateFirst.value && item.language !== props.sourceLang) {
        results.value[i] = { ...results.value[i], status: 'translating' };

        const transRes = await fetch(apiUrl('/api/translate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: inputText.value,
            sourceLang: props.sourceLang,
            targetLang: item.language,
          }),
        });

        const transData = await transRes.json();
        if (transData.success && transData.translatedText) {
          textToSynthesize = transData.translatedText;
          results.value[i] = { ...results.value[i], translatedText: textToSynthesize };
        } else {
          throw new Error(transData.error || 'Translation failed.');
        }
      } else {
        results.value[i] = { ...results.value[i], translatedText: textToSynthesize };
      }

      results.value[i] = { ...results.value[i], status: 'synthesizing' };

      let providerToUse: ProviderId = 'openai';
      let voiceId = 'openai-alloy';

      if (['ha', 'yo', 'ig'].includes(item.language)) {
        if (PROVIDER_CAPABILITIES.sahara.isConfigured) {
          providerToUse = 'sahara';
          const sVoice = AVAILABLE_VOICES.find((v) => v.language === item.language && v.provider === 'sahara');
          if (sVoice) voiceId = sVoice.id;
        }
      }

      const ttsRes = await fetch(apiUrl('/api/tts/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSynthesize,
          language: item.language,
          voiceId,
          provider: providerToUse,
        }),
      });

      const ttsData = await ttsRes.json();

      if (ttsData.success) {
        const timestamp = new Date().toISOString();
        const audioResult: TTSResult = {
          id: `ML-${Date.now()}-${item.language}`,
          audioBase64: ttsData.audioBase64,
          mimeType: ttsData.mimeType || 'audio/wav',
          durationSec: ttsData.durationSec || 5,
          text: textToSynthesize,
          language: item.language,
          voiceId,
          provider: providerToUse,
          timestamp,
        };

        results.value[i] = { ...results.value[i], status: 'success', audioResult };
        emit('saveResult', {
          id: audioResult.id,
          text: audioResult.text,
          language: audioResult.language,
          voiceName: voiceId,
          provider: audioResult.provider,
          audioBase64: audioResult.audioBase64,
          audioUrl: audioResult.audioUrl,
          durationSec: audioResult.durationSec,
          createdAt: timestamp,
        });
      } else {
        results.value[i] = { ...results.value[i], status: 'error', error: ttsData.error || 'TTS generation failed.' };
      }
    } catch (err) {
      results.value[i] = {
        ...results.value[i],
        status: 'error',
        error: err instanceof Error ? err.message : 'Operation failed',
      };
    }
  }

  isProcessing.value = false;
  activeStepMessage.value = '';
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
    <div class="bg-white border border-slate-200 rounded-lg max-w-4xl w-full p-5 shadow-lg text-slate-800 max-h-[92vh] flex flex-col">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <Globe2 class="w-5 h-5 text-slate-700" />
          <h3 class="text-base font-bold text-slate-900">Multi-Language Speech Generator</h3>
        </div>
        <button class="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" @click="$emit('close')">
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto py-4 space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Source Text:</label>
          <textarea
            v-model="inputText"
            rows="3"
            class="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors"
            placeholder="Enter message to broadcast across multiple African communities..."
          />
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div>
            <span class="text-xs font-semibold text-slate-800">Processing Mode:</span>
            <p class="text-[11px] text-slate-500">
              {{ translateFirst ? 'Translate text into each language before generating speech' : 'Synthesize raw text directly in selected language accents' }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              :class="translateFirst ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
              @click="translateFirst = true"
            >
              Translate First
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              :class="!translateFirst ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
              @click="translateFirst = false"
            >
              Direct Speech
            </button>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span class="font-semibold text-slate-700">Target Languages:</span>
            <span>{{ selectedLangs.length }} selected</span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="lang in LANGUAGES"
              :key="lang.code"
              type="button"
              class="flex items-center justify-between p-2 rounded-lg border text-left transition-colors"
              :class="selectedLangs.includes(lang.code)
                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 font-semibold'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'"
              @click="toggleLang(lang.code)"
            >
              <div class="truncate">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm">{{ lang.flag }}</span>
                  <span class="text-xs font-medium">{{ lang.name.split(' ')[0] }}</span>
                </div>
                <span class="text-[10px] text-slate-500 block truncate">{{ lang.nativeName }}</span>
              </div>
              <span v-if="lang.african" class="text-[9px] uppercase px-1 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                AFR
              </span>
            </button>
          </div>
        </div>

        <div class="pt-2">
          <button
            id="execute-multi-gen-btn"
            :disabled="isProcessing || !inputText.trim() || selectedLangs.length === 0"
            class="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-2"
            @click="executeMultiGeneration"
          >
            <template v-if="isProcessing">
              <RefreshCw class="w-4 h-4 animate-spin" />
              <span>{{ activeStepMessage || 'Generating speech across languages...' }}</span>
            </template>
            <template v-else>
              <Globe2 class="w-4 h-4" />
              <span>Generate Audio for {{ selectedLangs.length }} Languages</span>
            </template>
          </button>
        </div>

        <div v-if="results.length > 0" class="space-y-3 pt-3 border-t border-slate-100">
          <h4 class="text-xs font-semibold text-slate-700">Generated Audio Outputs ({{ results.length }}):</h4>

          <div class="space-y-3">
            <div
              v-for="item in results"
              :key="item.language"
              class="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-base">{{ langName(item.language)?.flag }}</span>
                  <span class="text-xs font-bold text-slate-900">{{ langName(item.language)?.name }}</span>
                  <span class="text-xs text-slate-500">({{ langName(item.language)?.nativeName }})</span>
                </div>

                <div>
                  <span v-if="item.status === 'pending'" class="text-xs text-slate-400">Queued</span>
                  <span v-else-if="item.status === 'translating'" class="text-xs text-amber-700 animate-pulse flex items-center gap-1">
                    <RefreshCw class="w-3 h-3 animate-spin" /> Translating...
                  </span>
                  <span v-else-if="item.status === 'synthesizing'" class="text-xs text-emerald-700 animate-pulse flex items-center gap-1">
                    <RefreshCw class="w-3 h-3 animate-spin" /> Synthesizing...
                  </span>
                  <span v-else-if="item.status === 'success'" class="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 class="w-3.5 h-3.5" /> Ready
                  </span>
                  <span v-else-if="item.status === 'error'" class="text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle class="w-3.5 h-3.5" /> Error
                  </span>
                </div>
              </div>

              <div v-if="item.translatedText" class="bg-white p-2 rounded text-xs text-slate-700 border border-slate-200">
                <span class="text-[10px] text-slate-500 uppercase font-semibold block mb-0.5">
                  {{ translateFirst ? 'Translated Text:' : 'Input Script:' }}
                </span>
                "{{ item.translatedText }}"
              </div>

              <div v-if="item.error" class="bg-rose-50 border border-rose-200 p-2.5 rounded text-xs text-rose-800">
                {{ item.error }}
              </div>

              <AudioWaveformPlayer
                v-if="item.audioResult"
                :audio-base64="item.audioResult.audioBase64"
                :audio-url="item.audioResult.audioUrl"
                :title="`${langName(item.language)?.name} Speech`"
                :language="item.language"
                :provider="item.provider"
                :duration-sec="item.audioResult.durationSec"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="pt-3 border-t border-slate-100 flex justify-end">
        <button
          class="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 transition-colors"
          @click="$emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
