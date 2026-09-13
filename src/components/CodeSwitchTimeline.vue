<script setup lang="ts">
import { Info, ArrowRightLeft } from 'lucide-vue-next';
import type { CodeSwitchAnalysis } from '../types';

// `analysis` is optional and may be undefined for monolingual samples upstream
// (the benchmark server only computes codeSwitchAnalysis when a sample is
// flagged hasCodeSwitching). Rendering unconditionally on `.segments` used to
// crash the whole page for any non-code-switched sample; this component now
// renders its own "not applicable" state instead of assuming a value exists.
defineProps<{
  analysis?: CodeSwitchAnalysis;
}>();

const LANG_COLOR_MAP: Record<string, { bg: string; text: string; border: string; label: string }> = {
  ha: { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-300', label: 'Hausa' },
  yo: { bg: 'bg-emerald-50', text: 'text-emerald-900', border: 'border-emerald-300', label: 'Yoruba' },
  ig: { bg: 'bg-purple-50', text: 'text-purple-900', border: 'border-purple-300', label: 'Igbo' },
  en: { bg: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-300', label: 'English' },
  fr: { bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-300', label: 'French' },
  zh: { bg: 'bg-red-50', text: 'text-red-900', border: 'border-red-300', label: 'Chinese' },
  hi: { bg: 'bg-orange-50', text: 'text-orange-900', border: 'border-orange-300', label: 'Hindi' },
  es: { bg: 'bg-yellow-50', text: 'text-yellow-900', border: 'border-yellow-300', label: 'Spanish' },
};

function styleFor(code: string) {
  return LANG_COLOR_MAP[code] || { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300', label: code };
}
</script>

<template>
  <div
    v-if="!analysis"
    class="text-xs text-slate-500 italic p-2.5 bg-slate-50 rounded-lg border border-slate-200"
  >
    Not applicable — this utterance is monolingual, so no code-switch analysis was computed.
  </div>

  <div
    v-else-if="!analysis.segments.length"
    class="text-xs text-slate-500 italic p-2.5 bg-slate-50 rounded-lg border border-slate-200"
  >
    No code-switch tokens detected in this utterance.
  </div>

  <div v-else class="bg-white border border-slate-200 rounded-lg p-3.5 text-slate-800 shadow-xs">
    <!-- Top Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-slate-900">Code-Switching Tokens</span>
        <span
          v-if="analysis.isCodeSwitched"
          class="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
        >
          Bilingual
        </span>
        <span v-else class="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
          Monolingual
        </span>
      </div>

      <div class="flex items-center gap-2 text-xs text-slate-500">
        <div class="flex items-center gap-1">
          <ArrowRightLeft class="w-3.5 h-3.5 text-slate-500" />
          <span>
            <strong class="text-slate-700">{{ analysis.transitionCount }}</strong>
            {{ analysis.transitionCount === 1 ? 'switch' : 'switches' }}
          </span>
        </div>
        <span>·</span>
        <span>
          Dominant: <strong class="text-slate-800 uppercase">{{ analysis.dominantLanguage }}</strong>
        </span>
      </div>
    </div>

    <!-- Segmented Timeline -->
    <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 mb-2.5 space-y-1.5">
      <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Token-Level Segmentation:</div>

      <div class="flex flex-wrap items-center gap-1.5 leading-relaxed">
        <span
          v-for="(seg, idx) in analysis.segments"
          :key="idx"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border"
          :class="[styleFor(seg.language).bg, styleFor(seg.language).text, styleFor(seg.language).border]"
          :title="`Inferred language: ${styleFor(seg.language).label} (confidence: ${Math.round(seg.confidence * 100)}%)`"
        >
          <span>{{ seg.text }}</span>
          <span class="text-[9px] uppercase font-bold opacity-70 px-1 rounded bg-black/10">{{ seg.language }}</span>
        </span>
      </div>
    </div>

    <!-- Language Legend -->
    <div class="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
      <span class="text-[10px] text-slate-500 uppercase font-semibold">Legend:</span>
      <template v-for="[code, style] in Object.entries(LANG_COLOR_MAP)" :key="code">
        <div v-if="analysis.segments.some((s) => s.language === code)" class="flex items-center gap-1 text-xs">
          <span class="w-2 h-2 rounded-full border" :class="[style.bg, style.border]" />
          <span class="text-slate-600">{{ style.label }}</span>
        </div>
      </template>
    </div>

    <!-- Mandatory Ethics/Inference Notice -->
    <div class="mt-2.5 flex items-start gap-2 text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
      <Info class="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
      <p class="leading-snug">
        <strong class="text-slate-800">{{ analysis.inferredNotice }}</strong>. Code-switch boundaries are inferred
        based on phonological and lexical markers.
      </p>
    </div>
  </div>
</template>
