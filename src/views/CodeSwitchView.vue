<script setup lang="ts">
import { ref, computed } from 'vue';
import { Sparkles, ArrowRightLeft, Languages, Info } from 'lucide-vue-next';
import { analyzeCodeSwitching } from '../services/benchmark/errorAnalysis';
import CodeSwitchTimeline from '../components/CodeSwitchTimeline.vue';
import type { LanguageCode } from '../types';

const inputText = ref(
  'The patient took two tablets of paracetamol yau da safe, but zazzabi still refused to come down.'
);
const baseLanguage = ref<LanguageCode>('en');

const presetExamples: Array<{ title: string; text: string; lang: LanguageCode }> = [
  {
    title: 'Nigerian English + Hausa Fever Assessment',
    text: 'The patient took two tablets of paracetamol yau da safe, but zazzabi still refused to come down.',
    lang: 'en',
  },
  {
    title: 'Nigerian English + Yoruba Triage Emergency',
    text: 'Please nurse, check the blood pressure now now, ara n gbọ̀n and she has severe headache since morning.',
    lang: 'en',
  },
  {
    title: 'Nigerian English + Igbo Pediatric Medication',
    text: 'Give the child ogwu akwa and plenty mmiri oyi to cool down the body temperature.',
    lang: 'en',
  },
  {
    title: 'Hausa Medical Consultation with English Terms',
    text: 'Likita ya ce ina da malaria kuma ina bukatar antibiotic na kwana bakwai.',
    lang: 'ha',
  },
];

function applyPreset(ex: (typeof presetExamples)[number]) {
  inputText.value = ex.text;
  baseLanguage.value = ex.lang;
}

const analysis = computed(() => analyzeCodeSwitching(inputText.value, baseLanguage.value));
</script>

<template>
  <div class="space-y-5 py-2 max-w-5xl mx-auto text-slate-800">
    <div>
      <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
        <Sparkles class="w-3.5 h-3.5 text-slate-600" />
        <span>Sociolinguistic Speech Explorer</span>
      </div>
      <h2 class="text-xl font-bold text-slate-900 tracking-tight">Code-Switching Explorer</h2>
      <p class="text-xs text-slate-600">
        In African healthcare settings, patients and clinicians often switch between English and regional languages
        like Hausa, Yoruba, or Igbo.
      </p>
    </div>

    <div class="space-y-1.5">
      <span class="text-xs text-slate-500 font-medium">Bilingual Clinical Presets:</span>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="(ex, idx) in presetExamples"
          :key="idx"
          class="p-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-left transition-colors shadow-xs"
          @click="applyPreset(ex)"
        >
          <div class="text-xs font-semibold text-slate-800 mb-0.5 flex items-center justify-between">
            <span>{{ ex.title }}</span>
            <span class="text-[10px] text-slate-500 uppercase font-mono">Preset</span>
          </div>
          <p class="text-xs text-slate-500 italic line-clamp-2">"{{ ex.text }}"</p>
        </button>
      </div>
    </div>

    <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs space-y-2.5">
      <div class="flex items-center justify-between text-xs text-slate-600">
        <label class="font-semibold text-slate-800">Bilingual Utterance to Analyze:</label>
        <span class="text-slate-500 text-[11px]">Real-time token boundary inference</span>
      </div>

      <textarea
        v-model="inputText"
        rows="3"
        class="w-full bg-white border border-slate-300 rounded-lg p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors leading-relaxed"
        placeholder="Type an intra-utterance code-switched sentence..."
      />
    </div>

    <CodeSwitchTimeline :analysis="analysis" />

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="p-3.5 bg-white border border-slate-200 rounded-lg space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <Languages class="w-3.5 h-3.5 text-slate-600" />
          <span>Fluid Bilingual Speech</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Code-switching is a standard communicative strategy across multilingual communities to convey medical nuance
          and comfort.
        </p>
      </div>

      <div class="p-3.5 bg-white border border-slate-200 rounded-lg space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <ArrowRightLeft class="w-3.5 h-3.5 text-slate-600" />
          <span>Boundary Challenges</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Standard speech models often experience accuracy drops at language transitions due to phonological and tonal
          shifts.
        </p>
      </div>

      <div class="p-3.5 bg-white border border-slate-200 rounded-lg space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <Info class="w-3.5 h-3.5 text-slate-600" />
          <span>Model Adaptation</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Models tuned on authentic African speech preserve critical symptom keywords like <em>zazzabi</em> (fever) and
          <em>ogwu</em> (medicine).
        </p>
      </div>
    </div>
  </div>
</template>
