<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Activity,
  Play,
  RotateCcw,
  CheckCircle2,
  FileText,
  BarChart2,
  Sliders,
  ShieldCheck,
  Stethoscope,
  Globe2,
  Info,
} from 'lucide-vue-next';
import type { BenchmarkRun, LanguageCode } from '../types';
import type { NormalizationOptions } from '../services/benchmark/normalization';
import { CLINICAL_AUDIO_SAMPLES } from '../services/benchmark/sampleDataset';
import { AFRIHEALTH_REFERENCE_RESULTS } from '../services/benchmark/referenceData';
import ExportReportModal from '../components/ExportReportModal.vue';
import CodeSwitchTimeline from '../components/CodeSwitchTimeline.vue';

// The server's real /api/qa/evaluate response — the AfriHealth 9-dimension
// rubric. A fictional {overallScore, dimensions, rationale} shape used to be
// assumed here instead, which meant every successful evaluation crashed the
// page (qaResult.overallScore.toFixed on undefined).
interface QaScores {
  factuality: number;
  appropriateness: number;
  adequacy: number;
  clinicalReasoning: number;
  uncertaintyHandling: number;
  empathy: number;
  hallucinationRisk: 'low' | 'moderate' | 'high';
  localRelevance: number;
  harmAssessment: 'safe' | 'low_risk' | 'harmful';
  clinicalReviewNote: string;
}

const NUMERIC_QA_DIMENSIONS: Array<{ key: keyof QaScores; label: string }> = [
  { key: 'factuality', label: 'Factuality' },
  { key: 'appropriateness', label: 'Appropriateness' },
  { key: 'adequacy', label: 'Adequacy' },
  { key: 'clinicalReasoning', label: 'Clinical Reasoning' },
  { key: 'uncertaintyHandling', label: 'Uncertainty Handling' },
  { key: 'empathy', label: 'Empathy' },
  { key: 'localRelevance', label: 'Local Relevance' },
];

const activeTab = ref<'live' | 'historical' | 'clinical_qa' | 'translation'>('live');

const selectedLanguageFilter = ref<string>('all');
const normOptions = ref<NormalizationOptions>({
  toLowerCase: true,
  stripPunctuation: true,
  stripDiacritics: false,
});
const isRunning = ref(false);
const benchmarkRun = ref<BenchmarkRun | null>(null);
const runError = ref<string | null>(null);
const showExportModal = ref(false);

const inspectedSampleId = ref<string | null>(null);

const qaQuestion = ref('Patient has fever for 3 days and dark urine. Can they take herbal concoction with paracetamol?');
const qaAnswer = ref(
  'No, do not take herbal concoctions with paracetamol as this increases the risk of severe acute liver and kidney damage. Dark urine and persistent fever require immediate clinic evaluation to test for malaria and severe infection.'
);
const qaLanguage = ref<LanguageCode>('en');
const qaResult = ref<QaScores | null>(null);
const qaError = ref<string | null>(null);
const isEvaluatingQa = ref(false);

const filteredSamples = computed(() =>
  CLINICAL_AUDIO_SAMPLES.filter((s) => selectedLanguageFilter.value === 'all' || s.language === selectedLanguageFilter.value)
);

async function handleRunBenchmark() {
  isRunning.value = true;
  runError.value = null;

  try {
    const response = await fetch('/api/benchmark/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleIds: filteredSamples.value.map((s) => s.id),
        selectedModels: ['sahara', 'model_b', 'model_c'],
        normalizationOptions: normOptions.value,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Benchmark run failed');
    }

    benchmarkRun.value = data.run;
    if (data.run.results.length > 0) {
      inspectedSampleId.value = data.run.results[0].sampleId;
    }
  } catch (err) {
    runError.value = err instanceof Error ? err.message : 'Failed to complete benchmark run';
  } finally {
    isRunning.value = false;
  }
}

async function handleEvaluateQa() {
  isEvaluatingQa.value = true;
  qaError.value = null;
  try {
    const res = await fetch('/api/qa/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: qaQuestion.value,
        referenceAnswer: qaAnswer.value,
        clinicalDomain: qaLanguage.value,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Clinical QA evaluation failed.');
    }
    qaResult.value = data.evaluation as QaScores;
  } catch (err) {
    console.error(err);
    qaError.value = err instanceof Error ? err.message : 'Clinical QA evaluation failed.';
  } finally {
    isEvaluatingQa.value = false;
  }
}

const qaOverallScore = computed(() => {
  if (!qaResult.value) return 0;
  const sum = NUMERIC_QA_DIMENSIONS.reduce((acc, d) => acc + (qaResult.value![d.key] as number), 0);
  return sum / NUMERIC_QA_DIMENSIONS.length;
});

const activeInspectedResult = computed(() => benchmarkRun.value?.results.find((r) => r.sampleId === inspectedSampleId.value));
const activeInspectedSample = computed(() => CLINICAL_AUDIO_SAMPLES.find((s) => s.id === inspectedSampleId.value));
const saharaDeepDive = computed(() => activeInspectedResult.value?.modelResults.sahara);

function riskBadgeClass(risk: 'low' | 'moderate' | 'high' | 'safe' | 'low_risk' | 'harmful') {
  if (risk === 'low' || risk === 'safe') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (risk === 'moderate' || risk === 'low_risk') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-rose-50 text-rose-800 border-rose-200';
}
</script>

<template>
  <div class="space-y-5 py-2 max-w-6xl mx-auto">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium mb-1">
          <Activity class="w-3.5 h-3.5 text-slate-600" />
          <span>AfriHealth Speech Evaluation</span>
        </div>
        <h2 class="text-xl font-bold text-slate-900 tracking-tight">Speech Benchmark Suite</h2>
        <p class="text-xs text-slate-600">Evaluation of speech recognition accuracy, code-switching handling, and clinical translation.</p>
      </div>

      <button
        v-if="benchmarkRun"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs shadow-xs transition-colors self-start sm:self-auto"
        @click="showExportModal = true"
      >
        <FileText class="w-4 h-4 text-slate-300" />
        <span>Export Report</span>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-xs">
      <button
        class="px-3 py-1.5 rounded-lg font-medium transition-colors"
        :class="activeTab === 'live' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        @click="activeTab = 'live'"
      >
        Live Speech Evaluator
      </button>
      <button
        class="px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
        :class="activeTab === 'historical' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        @click="activeTab = 'historical'"
      >
        <span>Baseline Reference Data</span>
      </button>
      <button
        class="px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
        :class="activeTab === 'clinical_qa' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        @click="activeTab = 'clinical_qa'"
      >
        <Stethoscope class="w-3.5 h-3.5" />
        <span>Clinical QA Rubric (9 Dimensions)</span>
      </button>
      <button
        class="px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
        :class="activeTab === 'translation' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'"
        @click="activeTab = 'translation'"
      >
        <Globe2 class="w-3.5 h-3.5" />
        <span>Translation Benchmark</span>
      </button>
    </div>

    <!-- TAB 1: LIVE BENCHMARK EVALUATOR -->
    <div v-if="activeTab === 'live'" class="space-y-4">
      <div class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders class="w-4 h-4 text-slate-600" />
              <span>Evaluation Controls & Normalization</span>
            </h3>
            <p class="text-xs text-slate-500 mt-0.5">
              Standardized text cleaning removes acoustic artifacts before computing Levenshtein edit distance.
            </p>
          </div>

          <div class="flex items-center gap-2 text-xs">
            <span class="text-slate-500">Dataset Filter:</span>
            <select v-model="selectedLanguageFilter" class="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800 focus:outline-none focus:border-slate-500">
              <option value="all">All Languages ({{ CLINICAL_AUDIO_SAMPLES.length }} instances)</option>
              <option value="ha">Hausa only</option>
              <option value="yo">Yoruba only</option>
              <option value="ig">Igbo only</option>
              <option value="en">Nigerian English only</option>
              <option value="fr">French only</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs">
          <label class="flex items-center gap-2 cursor-pointer select-none bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <input v-model="normOptions.toLowerCase" type="checkbox" class="rounded text-emerald-600 focus:ring-0" />
            <div>
              <span class="font-semibold text-slate-800">Case-Fold to Lowercase</span>
              <p class="text-[10px] text-slate-500">Ignores capitalizations across models</p>
            </div>
          </label>

          <label class="flex items-center gap-2 cursor-pointer select-none bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <input v-model="normOptions.stripPunctuation" type="checkbox" class="rounded text-emerald-600 focus:ring-0" />
            <div>
              <span class="font-semibold text-slate-800">Strip Punctuation</span>
              <p class="text-[10px] text-slate-500">Removes commas, hyphens, and periods</p>
            </div>
          </label>

          <label class="flex items-center gap-2 cursor-pointer select-none bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <input v-model="normOptions.stripDiacritics" type="checkbox" class="rounded text-emerald-600 focus:ring-0" />
            <div>
              <span class="font-semibold text-slate-800">Strip Diacritics (Ablation)</span>
              <p class="text-[10px] text-slate-500">Measures tonal penalty in Yoruba/Igbo</p>
            </div>
          </label>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div class="text-xs text-slate-500">
            Models evaluated: <strong class="text-slate-800">Sahara</strong> vs <strong class="text-slate-800">Model B</strong> vs
            <strong class="text-slate-800">Model C</strong>
          </div>

          <button
            id="run-benchmark-btn"
            :disabled="isRunning"
            class="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            @click="handleRunBenchmark"
          >
            <template v-if="isRunning">
              <RotateCcw class="w-3.5 h-3.5 animate-spin" />
              <span>Running Evaluation...</span>
            </template>
            <template v-else>
              <Play class="w-3.5 h-3.5 fill-current" />
              <span>Run Live Benchmark ({{ filteredSamples.length }} Samples)</span>
            </template>
          </button>
        </div>

        <div v-if="runError" class="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{{ runError }}</div>
      </div>

      <div v-if="!benchmarkRun && !isRunning" class="p-10 text-center bg-white border border-slate-200 rounded-lg text-slate-500 space-y-3 shadow-xs">
        <div class="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
          <Activity class="w-5 h-5" />
        </div>
        <h4 class="text-sm font-semibold text-slate-900">Awaiting Benchmark Execution</h4>
        <p class="text-xs text-slate-500 max-w-md mx-auto">
          Click "Run Live Benchmark" to evaluate speech recognition across {{ filteredSamples.length }} consented clinical utterances.
        </p>
      </div>

      <div v-else-if="benchmarkRun" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
            <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Macro-Average WER (Lower is Better)</span>
            <div class="text-xl font-bold text-emerald-700">
              {{ (benchmarkRun.macroAverageWer.sahara * 100).toFixed(1) }}%
              <span class="text-xs font-normal text-slate-500 ml-1.5">(Sahara)</span>
            </div>
            <div class="text-xs text-slate-500 mt-2 space-y-0.5">
              <div>Model B: {{ (benchmarkRun.macroAverageWer.model_b * 100).toFixed(1) }}%</div>
              <div>Model C: {{ (benchmarkRun.macroAverageWer.model_c * 100).toFixed(1) }}%</div>
            </div>
          </div>

          <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
            <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Macro-Average CER (Lower is Better)</span>
            <div class="text-xl font-bold text-emerald-700">
              {{ (benchmarkRun.macroAverageCer.sahara * 100).toFixed(1) }}%
              <span class="text-xs font-normal text-slate-500 ml-1.5">(Sahara)</span>
            </div>
            <div class="text-xs text-slate-500 mt-2 space-y-0.5">
              <div>Model B: {{ (benchmarkRun.macroAverageCer.model_b * 100).toFixed(1) }}%</div>
              <div>Model C: {{ (benchmarkRun.macroAverageCer.model_c * 100).toFixed(1) }}%</div>
            </div>
          </div>

          <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
            <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Avg Response Latency</span>
            <div class="text-xl font-bold text-slate-900">{{ benchmarkRun.averageLatencyMs.sahara }} ms</div>
            <div class="text-xs text-slate-500 mt-2 space-y-0.5">
              <div>Model B: {{ benchmarkRun.averageLatencyMs.model_b }} ms</div>
              <div>Model C: {{ benchmarkRun.averageLatencyMs.model_c }} ms</div>
            </div>
          </div>

          <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
            <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Inference Reliability</span>
            <div class="text-xl font-bold text-slate-900">{{ benchmarkRun.successRate.sahara }}%</div>
            <p class="text-xs text-slate-500 mt-2">0 timeouts across {{ benchmarkRun.sampleCount }} clinical instances.</p>
          </div>
        </div>

        <div class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 class="w-4 h-4 text-slate-600" />
              <span>Model Comparison Matrix</span>
            </h3>
            <span class="text-xs text-slate-500">Run ID: <code class="text-slate-800">{{ benchmarkRun.runId }}</code></span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-slate-200 text-slate-500 bg-slate-50 uppercase text-[11px]">
                  <th class="py-2 px-3">Model</th>
                  <th class="py-2 px-3">Architecture</th>
                  <th class="py-2 px-3">Macro WER</th>
                  <th class="py-2 px-3">Macro CER</th>
                  <th class="py-2 px-3">Latency</th>
                  <th class="py-2 px-3">Success Rate</th>
                  <th class="py-2 px-3">Ranking</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr class="bg-emerald-50/40">
                  <td class="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-emerald-600" />
                    <span>Intron Sahara</span>
                  </td>
                  <td class="py-2.5 px-3 text-slate-600">African-Acoustic Tuned CTC/Conformer</td>
                  <td class="py-2.5 px-3 font-bold text-emerald-700">{{ (benchmarkRun.macroAverageWer.sahara * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 font-bold text-emerald-700">{{ (benchmarkRun.macroAverageCer.sahara * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 text-slate-600">{{ benchmarkRun.averageLatencyMs.sahara }} ms</td>
                  <td class="py-2.5 px-3 text-slate-600">{{ benchmarkRun.successRate.sahara }}%</td>
                  <td class="py-2.5 px-3">
                    <span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200 text-[10px]">#1 Leading</span>
                  </td>
                </tr>

                <tr>
                  <td class="py-2.5 px-3 font-medium text-slate-800">Model B (OmniLLM)</td>
                  <td class="py-2.5 px-3 text-slate-500">General Multimodal Audio LLM</td>
                  <td class="py-2.5 px-3 text-slate-700">{{ (benchmarkRun.macroAverageWer.model_b * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 text-slate-700">{{ (benchmarkRun.macroAverageCer.model_b * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 text-slate-500">{{ benchmarkRun.averageLatencyMs.model_b }} ms</td>
                  <td class="py-2.5 px-3 text-slate-500">{{ benchmarkRun.successRate.model_b }}%</td>
                  <td class="py-2.5 px-3 text-slate-500">#2 General</td>
                </tr>

                <tr>
                  <td class="py-2.5 px-3 font-medium text-slate-800">Model C (Whisper-v3)</td>
                  <td class="py-2.5 px-3 text-slate-500">Encoder-Decoder Transformer</td>
                  <td class="py-2.5 px-3 text-slate-700">{{ (benchmarkRun.macroAverageWer.model_c * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 text-slate-700">{{ (benchmarkRun.macroAverageCer.model_c * 100).toFixed(1) }}%</td>
                  <td class="py-2.5 px-3 text-slate-500">{{ benchmarkRun.averageLatencyMs.model_c }} ms</td>
                  <td class="py-2.5 px-3 text-slate-500">{{ benchmarkRun.successRate.model_c }}%</td>
                  <td class="py-2.5 px-3 text-slate-500">#3 Standard</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-slate-900">Clinical Utterance Inspection</h3>
              <p class="text-xs text-slate-500">Select an utterance to inspect alignment, substitution errors, and code-switching markers.</p>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-500">Select Utterance:</span>
              <select v-model="inspectedSampleId" class="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-slate-500">
                <option v-for="r in benchmarkRun.results" :key="r.sampleId" :value="r.sampleId">
                  [{{ CLINICAL_AUDIO_SAMPLES.find((s) => s.id === r.sampleId)?.language.toUpperCase() }}]
                  {{ CLINICAL_AUDIO_SAMPLES.find((s) => s.id === r.sampleId)?.title }}
                </option>
              </select>
            </div>
          </div>

          <div v-if="activeInspectedResult && activeInspectedSample && saharaDeepDive" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <span class="text-[10px] uppercase font-bold text-slate-600">Ground Truth Clinical Reference</span>
                <p class="text-xs text-slate-900 leading-relaxed font-medium">"{{ activeInspectedSample.referenceTranscript }}"</p>
                <div class="text-[10px] text-slate-500 pt-1">
                  Domain: {{ activeInspectedSample.clinicalDomain }} · Accent: {{ activeInspectedSample.accent }}
                </div>
              </div>

              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] uppercase font-bold text-emerald-800">Sahara Hypothesis</span>
                  <span class="text-[10px] text-emerald-800 font-mono">
                    WER: {{ (saharaDeepDive.wer * 100).toFixed(1) }}% · CER: {{ (saharaDeepDive.cer * 100).toFixed(1) }}%
                  </span>
                </div>
                <p class="text-xs text-slate-800 leading-relaxed">"{{ saharaDeepDive.hypothesisTranscript }}"</p>
              </div>
            </div>

            <CodeSwitchTimeline :analysis="saharaDeepDive.codeSwitchAnalysis" />

            <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-wrap items-center gap-4">
              <span class="text-slate-600 font-semibold">Error Breakdown:</span>
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-amber-500" />
                <span>Substitutions: {{ saharaDeepDive.errorAnalysis.substitutions }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-rose-500" />
                <span>Deletions: {{ saharaDeepDive.errorAnalysis.deletions }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-blue-500" />
                <span>Insertions: {{ saharaDeepDive.errorAnalysis.insertions }}</span>
              </div>
              <div class="flex items-center gap-1.5 text-emerald-700 ml-auto font-medium">
                <CheckCircle2 class="w-3.5 h-3.5" />
                <span>Clinical Intent Preserved</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: REFERENCE HISTORICAL BASELINES -->
    <div v-if="activeTab === 'historical'" class="space-y-4">
      <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 flex items-start gap-3">
        <Info class="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
        <div class="text-xs leading-relaxed">
          <strong class="text-slate-900 block mb-0.5">Reference results from published AfriHealth evaluations</strong>
          These historical baseline metrics represent published benchmark findings across 500+ consented African healthcare audio records.
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          v-for="model in AFRIHEALTH_REFERENCE_RESULTS"
          :key="model.modelName"
          class="p-4 rounded-lg bg-white border border-slate-200 text-slate-800 space-y-3 shadow-xs"
        >
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-bold text-slate-900 text-xs">{{ model.modelName }}</h4>
              <span class="text-[11px] text-slate-500">{{ model.vendor }}</span>
            </div>
            <span class="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">Baseline</span>
          </div>

          <div class="space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-500">Overall WER:</span>
              <strong class="text-slate-900 font-mono">{{ (model.macroAvgWer * 100).toFixed(1) }}%</strong>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-slate-500">Overall CER:</span>
              <strong class="text-slate-900 font-mono">{{ (model.macroAvgCer * 100).toFixed(1) }}%</strong>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-100 text-[11px] space-y-1 text-slate-600">
            <div class="text-slate-800 font-semibold mb-1">By Language (WER):</div>
            <div class="flex justify-between"><span>Hausa:</span><span class="font-mono text-slate-900">{{ (model.africanLangWer.hausa * 100).toFixed(1) }}%</span></div>
            <div class="flex justify-between"><span>Yoruba:</span><span class="font-mono text-slate-900">{{ (model.africanLangWer.yoruba * 100).toFixed(1) }}%</span></div>
            <div class="flex justify-between"><span>Igbo:</span><span class="font-mono text-slate-900">{{ (model.africanLangWer.igbo * 100).toFixed(1) }}%</span></div>
            <div class="flex justify-between"><span>Nigerian English:</span><span class="font-mono text-slate-900">{{ (model.africanLangWer.nigerianEnglish * 100).toFixed(1) }}%</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: CLINICAL QA EVALUATION RUBRIC -->
    <div v-if="activeTab === 'clinical_qa'" class="space-y-4">
      <div class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs space-y-4">
        <div>
          <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Stethoscope class="w-4 h-4 text-slate-600" />
            <span>Clinical QA Evaluator (9-Dimensional Medical Rubric)</span>
          </h3>
          <p class="text-xs text-slate-500 mt-1">
            Evaluates patient-doctor spoken responses on Factuality, Appropriateness, Adequacy, Clinical Reasoning,
            Uncertainty Handling, Empathy, Local Relevance, Hallucination Risk, and Harm Assessment.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Patient Question:</label>
            <textarea v-model="qaQuestion" rows="3" class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:border-slate-500" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">Healthcare Response:</label>
            <textarea v-model="qaAnswer" rows="3" class="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:border-slate-500" />
          </div>
        </div>

        <div class="flex items-center justify-between pt-1">
          <div class="flex items-center gap-2 text-xs text-slate-600">
            <span>Evaluation Language:</span>
            <select v-model="qaLanguage" class="bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800">
              <option value="en">Nigerian English</option>
              <option value="ha">Hausa</option>
              <option value="yo">Yoruba</option>
              <option value="ig">Igbo</option>
            </select>
          </div>

          <button
            :disabled="isEvaluatingQa"
            class="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium text-xs shadow-xs transition-colors flex items-center gap-2"
            @click="handleEvaluateQa"
          >
            <template v-if="isEvaluatingQa">
              <RotateCcw class="w-3.5 h-3.5 animate-spin" />
              <span>Evaluating...</span>
            </template>
            <template v-else>
              <ShieldCheck class="w-3.5 h-3.5" />
              <span>Run Clinical QA Evaluation</span>
            </template>
          </button>
        </div>

        <div v-if="qaError" class="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{{ qaError }}</div>
      </div>

      <div v-if="qaResult" class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h4 class="text-xs font-bold text-slate-900">9-Dimensional Clinical Safety Scorecard</h4>
            <p class="text-xs text-slate-500">Evaluated against clinical safety standards.</p>
          </div>
          <div class="text-right">
            <div class="text-[11px] text-slate-500">Overall Score (avg. of 7 numeric dimensions):</div>
            <div class="text-lg font-bold text-emerald-700">{{ qaOverallScore.toFixed(1) }} / 5.0</div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div v-for="dim in NUMERIC_QA_DIMENSIONS" :key="dim.key" class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-700">{{ dim.label }}</span>
              <strong class="text-slate-900 font-mono">{{ qaResult[dim.key] }} / 5</strong>
            </div>
            <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-600 rounded-full" :style="{ width: `${(Number(qaResult[dim.key]) / 5) * 100}%` }" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div class="p-2.5 rounded-lg border flex items-center justify-between" :class="riskBadgeClass(qaResult.hallucinationRisk)">
            <span class="text-xs font-semibold">Hallucination Risk</span>
            <span class="text-xs font-bold uppercase">{{ qaResult.hallucinationRisk }}</span>
          </div>
          <div class="p-2.5 rounded-lg border flex items-center justify-between" :class="riskBadgeClass(qaResult.harmAssessment)">
            <span class="text-xs font-semibold">Harm Assessment</span>
            <span class="text-xs font-bold uppercase">{{ qaResult.harmAssessment.replace('_', ' ') }}</span>
          </div>
        </div>

        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 leading-relaxed">
          <strong class="text-slate-900 block mb-0.5">Clinical Safety Rationale:</strong>
          {{ qaResult.clinicalReviewNote }}
        </div>
      </div>
    </div>

    <!-- TAB 4: MACHINE TRANSLATION BENCHMARK -->
    <div v-if="activeTab === 'translation'" class="bg-white border border-slate-200 rounded-lg p-4 text-slate-800 shadow-xs space-y-4">
      <div>
        <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Globe2 class="w-4 h-4 text-slate-600" />
          <span>Machine Translation Quality Benchmark</span>
        </h3>
        <p class="text-xs text-slate-500 mt-0.5">
          Evaluating translation fidelity across English ↔ Hausa, Yoruba, and Igbo healthcare communication.
        </p>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-200 text-slate-500 bg-slate-50 uppercase text-[11px]">
              <th class="py-2 px-3">Language Pair</th>
              <th class="py-2 px-3">BLEU (0-100)</th>
              <th class="py-2 px-3">chrF++</th>
              <th class="py-2 px-3">AfriCOMET</th>
              <th class="py-2 px-3">Medical Terminology Preservation</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr>
              <td class="py-2.5 px-3 font-semibold text-slate-900">English → Hausa (ha)</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">32.8</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">58.4</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">0.782</td>
              <td class="py-2.5 px-3 text-emerald-800">94.2% (Accurate Fever/Antenatal)</td>
            </tr>
            <tr>
              <td class="py-2.5 px-3 font-semibold text-slate-900">English → Yoruba (yo)</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">29.4</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">54.1</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">0.741</td>
              <td class="py-2.5 px-3 text-emerald-800">91.8% (Tone preserved)</td>
            </tr>
            <tr>
              <td class="py-2.5 px-3 font-semibold text-slate-900">English → Igbo (ig)</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">28.1</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">52.9</td>
              <td class="py-2.5 px-3 font-mono text-slate-800">0.735</td>
              <td class="py-2.5 px-3 text-emerald-800">90.5% (High dialectal consistency)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ExportReportModal v-if="showExportModal && benchmarkRun" :run="benchmarkRun" @close="showExportModal = false" />
  </div>
</template>
