<script setup lang="ts">
import { X, ArrowRightLeft } from 'lucide-vue-next';
import type { SavedResultItem } from '../types';
import AudioWaveformPlayer from './AudioWaveformPlayer.vue';

defineProps<{
  itemA: SavedResultItem;
  itemB: SavedResultItem;
}>();

defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
    <div class="bg-white border border-slate-200 rounded-lg max-w-4xl w-full p-5 shadow-lg text-slate-800 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <ArrowRightLeft class="w-5 h-5 text-slate-700" />
          <h3 class="text-base font-bold text-slate-900">Side-by-Side Audio Comparison</h3>
        </div>
        <button
          class="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          @click="$emit('close')"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div class="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase text-slate-700">Version A</span>
            <span class="text-xs text-slate-500 capitalize">{{ itemA.provider }} · {{ itemA.voiceName }}</span>
          </div>
          <p class="text-xs text-slate-700 bg-white p-2.5 rounded border border-slate-200">"{{ itemA.text }}"</p>
          <AudioWaveformPlayer
            :audio-base64="itemA.audioBase64"
            :audio-url="itemA.audioUrl"
            :title="`Version A (${itemA.language.toUpperCase()})`"
            :language="itemA.language"
            :provider="itemA.provider"
            :duration-sec="itemA.durationSec"
          />
        </div>

        <div class="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase text-slate-700">Version B</span>
            <span class="text-xs text-slate-500 capitalize">{{ itemB.provider }} · {{ itemB.voiceName }}</span>
          </div>
          <p class="text-xs text-slate-700 bg-white p-2.5 rounded border border-slate-200">"{{ itemB.text }}"</p>
          <AudioWaveformPlayer
            :audio-base64="itemB.audioBase64"
            :audio-url="itemB.audioUrl"
            :title="`Version B (${itemB.language.toUpperCase()})`"
            :language="itemB.language"
            :provider="itemB.provider"
            :duration-sec="itemB.durationSec"
          />
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
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
