<script setup lang="ts">
import { ShieldCheck, Lock, Eye, AlertOctagon, Heart } from 'lucide-vue-next';
</script>

<template>
  <div class="space-y-6 py-2 max-w-4xl mx-auto text-slate-800">
    <div>
      <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
        <ShieldCheck class="w-3.5 h-3.5 text-slate-600" />
        <span>Ethics & Privacy</span>
      </div>
      <h2 class="text-xl font-bold text-slate-900 tracking-tight">Ethics, Privacy & Data Standards</h2>
      <p class="text-xs text-slate-600">Responsible evaluation standards, data privacy, and clinical communication guidelines.</p>
    </div>

    <section class="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1.5">
      <div class="flex items-center gap-1.5 font-bold text-xs text-amber-900">
        <AlertOctagon class="w-4 h-4 shrink-0 text-amber-700" />
        <span>Clinical Disclaimer</span>
      </div>
      <p class="text-xs leading-relaxed text-amber-800">
        AfriVoice Studio is designed for speech intelligence, translation assessment, and educational research. It does
        <strong>not</strong> provide automated medical diagnoses or substitute for consultation with licensed healthcare
        professionals.
      </p>
    </section>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
          <Heart class="w-3.5 h-3.5 text-slate-600" />
          <span>1. Consented Community Data</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Speech samples and evaluation benchmarks adhere to informed consent protocols with local language speakers
          and clinical contributors.
        </p>
      </div>

      <div class="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
          <Lock class="w-3.5 h-3.5 text-slate-600" />
          <span>2. Privacy & PII Protection</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Personal identifying details, patient names, and institutional identifiers are scrubbed from all reference
          samples to protect confidentiality.
        </p>
      </div>

      <div class="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
          <Eye class="w-3.5 h-3.5 text-slate-600" />
          <span>3. Objective Metric Reporting</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Metrics are calculated using standard Levenshtein edit distance algorithms without score inflation or
          artificial weighting.
        </p>
      </div>

      <div class="p-4 rounded-lg bg-white border border-slate-200 space-y-1.5 shadow-xs">
        <div class="flex items-center gap-1.5 text-slate-900 text-xs font-semibold">
          <ShieldCheck class="w-3.5 h-3.5 text-slate-600" />
          <span>4. Linguistic Non-Discrimination</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          High performance on English benchmarks does not substitute for native evaluation in Hausa, Yoruba, and Igbo.
          Each language is evaluated individually.
        </p>
      </div>
    </div>

    <section class="p-4 bg-white border border-slate-200 rounded-lg shadow-xs space-y-2">
      <h3 class="text-sm font-bold text-slate-900">Open Research & Local Capacity</h3>
      <p class="text-xs text-slate-600 leading-relaxed">
        The development of speech technologies should empower local healthcare workers and researchers with open tools
        to evaluate, refine, and deploy accurate voice AI solutions.
      </p>
    </section>
  </div>
</template>
