<script setup lang="ts">
import { BookOpen, Calculator, Sparkles, ShieldAlert, Layers } from 'lucide-vue-next';
</script>

<template>
  <div class="space-y-6 py-2 max-w-4xl mx-auto text-slate-800">
    <div>
      <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
        <BookOpen class="w-3.5 h-3.5 text-slate-600" />
        <span>Evaluation Standards</span>
      </div>
      <h2 class="text-xl font-bold text-slate-900 tracking-tight">Benchmarking Methodology & Metrics</h2>
      <p class="text-xs text-slate-600">Algorithmic foundations based on standard speech evaluation metrics and clinical rubrics.</p>
    </div>

    <section class="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-3">
      <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Layers class="w-4 h-4 text-slate-600" />
        <span>1. Three Pillars of Evaluation</span>
      </h3>
      <p class="text-xs text-slate-600 leading-relaxed">Evaluation spans three interrelated healthcare communication tasks:</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
          <h4 class="text-xs font-semibold text-slate-900">Speech Recognition (ASR)</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Assessing phonetic and lexical transcription accuracy across accents, background hospital noise, and bilingual speech.
          </p>
        </div>
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
          <h4 class="text-xs font-semibold text-slate-900">Machine Translation (MT)</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Evaluating n-gram overlap, character F-scores, and semantic preservation from English into Hausa, Yoruba, and Igbo.
          </p>
        </div>
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
          <h4 class="text-xs font-semibold text-slate-900">Spoken Clinical QA</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            A 9-dimensional medical safety rubric ensuring models do not recommend harmful remedies or omit emergency triage warnings.
          </p>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-3">
      <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Calculator class="w-4 h-4 text-slate-600" />
        <span>2. Mathematical Formulations & Edit Distances</span>
      </h3>

      <div class="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-slate-900">Word Error Rate (WER)</h4>
          <span class="font-mono text-xs text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">WER = (S + D + I) / N</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Computed using the <strong>Wagner-Fischer Dynamic Programming algorithm</strong>. Token sequences from the ground-truth
          reference and hypothesis are aligned to calculate minimum edit operations:
        </p>
        <ul class="text-xs text-slate-600 space-y-0.5 pl-4 list-disc">
          <li><strong>S (Substitutions):</strong> Incorrect words transcribed in place of ground truth.</li>
          <li><strong>D (Deletions):</strong> Spoken words omitted by the model.</li>
          <li><strong>I (Insertions):</strong> Hallucinated words added by the model.</li>
          <li><strong>N:</strong> Total count of words in ground-truth reference sequence.</li>
        </ul>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-slate-900">Character Error Rate (CER)</h4>
          <span class="font-mono text-xs text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">CER = Levenshtein(Ref, Hyp) / |Ref|</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          Character-level edit distance provides insight into morphological accuracy in tone and affix-rich African languages,
          where single prefix substitutions change medical meaning.
        </p>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-slate-900">Translation Metrics (BLEU & chrF++)</h4>
          <span class="font-mono text-xs text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">chrF++ (β=2 character n-gram F-score)</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">
          While sentence BLEU measures modified n-gram precision, <strong>chrF++</strong> correlates more closely with human
          clinician ratings for lower-resource languages by evaluating sub-word stems without penalizing minor spelling differences.
        </p>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-3">
      <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
        <Sparkles class="w-4 h-4 text-slate-600" />
        <span>3. Text Normalization Pipeline</span>
      </h3>
      <p class="text-xs text-slate-600 leading-relaxed">
        To prevent false errors due to differing punctuation or casing across providers, standard text cleaning is applied
        prior to scoring:
      </p>
      <div class="space-y-1.5 text-xs text-slate-600">
        <div class="flex items-start gap-2">
          <span class="w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5 border border-slate-200">1</span>
          <span><strong>Unicode Normalization (NFC):</strong> Standardizes diverse keyboard encodings for African vowel markers.</span>
        </div>
        <div class="flex items-start gap-2">
          <span class="w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5 border border-slate-200">2</span>
          <span><strong>Punctuation & Whitespace Cleaning:</strong> Strips hyphens, quotes, ellipses, and collapses multiple spaces.</span>
        </div>
        <div class="flex items-start gap-2">
          <span class="w-4 h-4 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5 border border-slate-200">3</span>
          <span><strong>Diacritic Study:</strong> Enables testing with and without sub-dots/accents to isolate acoustic vs orthographic discrepancies.</span>
        </div>
      </div>
    </section>

    <section class="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-3">
      <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
        <ShieldAlert class="w-4 h-4 text-slate-600" />
        <span>4. Scope & Limitations</span>
      </h3>
      <div class="space-y-1.5 text-xs text-slate-600 leading-relaxed">
        <p>Key boundaries for the current evaluation:</p>
        <ul class="space-y-1 pl-4 list-disc text-slate-600">
          <li>
            <strong class="text-slate-800">Linguistic Focus:</strong> Datasets currently center on Nigerian healthcare
            interactions (Hausa, Igbo, Yoruba, Nigerian English). Additional evaluation is required before generalizing
            to East or Southern African languages.
          </li>
          <li>
            <strong class="text-slate-800">Dialectal Variants:</strong> Regional variants (e.g. Kano vs Sokoto Hausa,
            Central vs Onitsha Igbo) have acoustic nuances that may influence model precision.
          </li>
          <li>
            <strong class="text-slate-800">Research Tool:</strong> This platform is designed for research, literacy, and
            model benchmarking. It does not replace medical consultation.
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
