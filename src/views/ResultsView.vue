<script setup lang="ts">
import { ref, computed } from 'vue';
import { Library, Trash2, ArrowRightLeft, Filter, Volume2, Calendar } from 'lucide-vue-next';
import { LANGUAGES, type SavedResultItem } from '../types';
import AudioWaveformPlayer from '../components/AudioWaveformPlayer.vue';
import CompareAudioModal from '../components/CompareAudioModal.vue';
import type { NavTab } from '../components/navTabs';

const props = defineProps<{
  results: SavedResultItem[];
}>();

const emit = defineEmits<{
  (e: 'deleteResult', id: string): void;
  (e: 'clearAll'): void;
  (e: 'navigate', tab: NavTab): void;
}>();

const selectedLanguage = ref<string>('all');
const selectedProvider = ref<string>('all');
const compareIds = ref<string[]>([]);
const showCompareModal = ref(false);

const filteredResults = computed(() =>
  props.results.filter((item) => {
    const matchLang = selectedLanguage.value === 'all' || item.language === selectedLanguage.value;
    const matchProv = selectedProvider.value === 'all' || item.provider === selectedProvider.value;
    return matchLang && matchProv;
  })
);

function toggleCompareSelect(id: string) {
  if (compareIds.value.includes(id)) {
    compareIds.value = compareIds.value.filter((item) => item !== id);
  } else if (compareIds.value.length >= 2) {
    compareIds.value = [compareIds.value[1], id];
  } else {
    compareIds.value = [...compareIds.value, id];
  }
}

const itemA = computed(() => props.results.find((r) => r.id === compareIds.value[0]));
const itemB = computed(() => props.results.find((r) => r.id === compareIds.value[1]));

function langOf(item: SavedResultItem) {
  return LANGUAGES.find((l) => l.code === item.language);
}
</script>

<template>
  <div class="space-y-5 py-2 max-w-5xl mx-auto">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Library class="w-5 h-5 text-emerald-700" />
          <span>Audio Library</span>
        </h2>
        <p class="text-xs text-slate-600 mt-0.5">View, play, download, and compare your generated voice recordings.</p>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="compareIds.length === 2"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs shadow-xs transition-colors"
          @click="showCompareModal = true"
        >
          <ArrowRightLeft class="w-3.5 h-3.5" />
          <span>Compare Selected (2)</span>
        </button>

        <button
          v-if="results.length > 0"
          class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-600 border border-slate-300 text-xs font-medium transition-colors"
          @click="$emit('clearAll')"
        >
          <Trash2 class="w-3.5 h-3.5" />
          <span>Clear Library</span>
        </button>
      </div>
    </div>

    <div v-if="results.length > 0" class="flex flex-wrap items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 shadow-xs">
      <div class="flex items-center gap-1.5 font-semibold text-slate-800">
        <Filter class="w-3.5 h-3.5 text-slate-500" />
        <span>Filter:</span>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-slate-500">Language:</span>
        <select v-model="selectedLanguage" class="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-slate-500">
          <option value="all">All Languages</option>
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-slate-500">Provider:</span>
        <select v-model="selectedProvider" class="bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-slate-500">
          <option value="all">All Providers</option>
          <option value="sahara">Sahara</option>
          <option value="openai">OpenAI</option>
          <option value="browser">Device Browser</option>
        </select>
      </div>

      <div class="ml-auto text-[11px] text-slate-500">Showing {{ filteredResults.length }} of {{ results.length }} recordings</div>
    </div>

    <div v-if="filteredResults.length === 0" class="text-center py-12 px-4 bg-white border border-slate-200 rounded-lg space-y-3 shadow-xs">
      <div class="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
        <Volume2 class="w-5 h-5" />
      </div>
      <h3 class="text-base font-semibold text-slate-900">No Audio Recordings in Library</h3>
      <p class="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
        Synthesize speech in Hausa, Yoruba, Igbo, or other languages and click "Save to Library" to build your session collection.
      </p>
      <button
        class="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-xs transition-colors"
        @click="$emit('navigate', 'generator')"
      >
        Open Voice Generator
      </button>
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="item in filteredResults"
        :key="item.id"
        class="bg-white border rounded-lg p-4 shadow-xs transition-colors"
        :class="compareIds.includes(item.id) ? 'border-emerald-600 ring-1 ring-emerald-600' : 'border-slate-200'"
      >
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-2">
            <span class="text-base">{{ langOf(item)?.flag }}</span>
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-slate-900">{{ langOf(item)?.name }}</span>
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 capitalize">
                  {{ item.provider }}
                </span>
              </div>
              <div class="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                <span class="capitalize">{{ item.voiceName }}</span>
                <span>·</span>
                <span class="flex items-center gap-1">
                  <Calendar class="w-3 h-3" />
                  {{ new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border transition-colors"
              :class="compareIds.includes(item.id) ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'"
              @click="toggleCompareSelect(item.id)"
            >
              <ArrowRightLeft class="w-3.5 h-3.5" />
              <span>{{ compareIds.includes(item.id) ? 'Selected' : 'Compare' }}</span>
            </button>

            <button
              class="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors"
              title="Delete recording"
              @click="$emit('deleteResult', item.id)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="p-2.5 bg-slate-50 rounded border border-slate-200 mb-3 text-xs text-slate-700 leading-relaxed">"{{ item.text }}"</div>

        <AudioWaveformPlayer
          :audio-base64="item.audioBase64"
          :audio-url="item.audioUrl"
          :title="`${langOf(item)?.name} Recording`"
          :language="item.language"
          :provider="item.provider"
          :duration-sec="item.durationSec"
        />
      </div>
    </div>

    <CompareAudioModal
      v-if="showCompareModal && itemA && itemB"
      :item-a="itemA"
      :item-b="itemB"
      @close="showCompareModal = false"
    />
  </div>
</template>
