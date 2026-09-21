<script setup lang="ts">
import { ref, watch, onMounted, defineAsyncComponent } from 'vue';
import type { NavTab } from './components/navTabs';
import IntakeView from './views/IntakeView.vue';
import AppErrorBoundary from './components/AppErrorBoundary.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';
import { Volume2, ShieldCheck } from 'lucide-vue-next';
import type { SavedResultItem, ProviderCapability } from './types';
import { PROVIDER_CAPABILITIES } from './services/tts/voices';
import { logError } from './utils/diagnostics';
import { apiUrl } from './services/api/apiBase';

// The default (non-studio) landing is only ever IntakeView — every visitor
// downloads it, so it stays a static import. Everything below is only
// reachable via ?studio=1 (Navbar itself is v-if="studioMode" and never
// even renders otherwise), so it's loaded on demand instead of bloating
// the bundle every SabiLine visitor pays for.
const Navbar = defineAsyncComponent(() => import('./components/Navbar.vue'));
const HomeView = defineAsyncComponent(() => import('./views/HomeView.vue'));
const VoiceGeneratorView = defineAsyncComponent(() => import('./views/VoiceGeneratorView.vue'));
const ResultsView = defineAsyncComponent(() => import('./views/ResultsView.vue'));
const BenchmarkView = defineAsyncComponent(() => import('./views/BenchmarkView.vue'));
const CodeSwitchView = defineAsyncComponent(() => import('./views/CodeSwitchView.vue'));
const MethodologyView = defineAsyncComponent(() => import('./views/MethodologyView.vue'));
const ImpactView = defineAsyncComponent(() => import('./views/ImpactView.vue'));
const EthicsView = defineAsyncComponent(() => import('./views/EthicsView.vue'));

// The live site's default experience is just the SabiLine intake demo — no
// nav chrome, landing straight on Patient Intake, matching the standalone
// demo this was built from. The rest of the original AfriVoice Studio
// (Voice Generator, Benchmark, Code-Switching, Methodology/Impact/Ethics)
// stays in the app for anyone who wants to see it — append ?studio=1 to the
// URL to get the full studio shell with its nav bar, starting on Home.
const studioMode = ref(new URLSearchParams(window.location.search).has('studio'));
const activeTab = ref<NavTab>(studioMode.value ? 'home' : 'intake');

function loadSavedResults(): SavedResultItem[] {
  try {
    const stored = localStorage.getItem('afrivoice_saved_results');
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    logError('localStorage:read', err);
    return [];
  }
}

const savedResults = ref<SavedResultItem[]>(loadSavedResults());
const storageWarning = ref<string | null>(null);

// Seed provider state from the real capability definitions (correct shape),
// then refresh isConfigured/statusMessage live from the server below. The
// previous implementation replaced this whole object with a hand-rolled
// literal that didn't satisfy ProviderCapability and broke the build.
const providers = ref<Record<string, ProviderCapability>>(
  JSON.parse(JSON.stringify(PROVIDER_CAPABILITIES))
);

async function fetchProviders() {
  try {
    const res = await fetch(apiUrl('/api/providers/status'));
    if (!res.ok) return;
    const data = await res.json();
    if (!data.providers) return;

    for (const key of Object.keys(providers.value)) {
      const live = data.providers[key];
      if (live) {
        providers.value[key] = {
          ...providers.value[key],
          isConfigured: Boolean(live.isConfigured),
          statusMessage: live.statusMessage ?? providers.value[key].statusMessage,
        };
      }
    }
  } catch (err) {
    console.warn('Could not fetch server provider status; using client defaults', err);
  }
}

onMounted(fetchProviders);

watch(
  savedResults,
  (results) => {
    try {
      localStorage.setItem('afrivoice_saved_results', JSON.stringify(results));
      storageWarning.value = null;
    } catch (err) {
      logError('localStorage:write', err);
      storageWarning.value =
        'Your browser storage is full, so the newest recording may not have been saved for next time. Try clearing some items from My Results.';
    }
  },
  { deep: true }
);

function handleSaveToLibrary(item: SavedResultItem) {
  savedResults.value = [item, ...savedResults.value.filter((p) => p.id !== item.id)];
}

function handleDeleteResult(id: string) {
  savedResults.value = savedResults.value.filter((item) => item.id !== id);
}

function handleClearAllResults() {
  if (window.confirm('Are you sure you want to clear your saved audio recordings?')) {
    savedResults.value = [];
  }
}

function providerStatus() {
  return {
    saharaConfigured: Boolean(providers.value.sahara?.isConfigured),
    openaiConfigured: Boolean(providers.value.openai?.isConfigured),
  };
}
</script>

<template>
  <div class="min-h-screen flex flex-col font-sans" :class="studioMode ? 'bg-slate-50 text-slate-800' : ''">
    <Navbar
      v-if="studioMode"
      :active-tab="activeTab"
      :result-count="savedResults.length"
      :provider-status="providerStatus()"
      @select="(tab) => (activeTab = tab)"
    />

    <main
      class="flex-1 w-full"
      :class="studioMode ? 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' : ''"
    >
      <div v-if="storageWarning" class="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
        {{ storageWarning }}
      </div>

      <!-- :key forces the boundary (and its hasError state) to reset whenever
           the user switches tabs, matching the fallback UI's own "switch to
           a different tab" recovery instruction. -->
      <AppErrorBoundary :key="activeTab">
        <HomeView v-if="activeTab === 'home'" @navigate="(tab) => (activeTab = tab)" />

        <VoiceGeneratorView
          v-else-if="activeTab === 'generator'"
          :saved-results="savedResults"
          :providers="providers"
          @save-to-library="handleSaveToLibrary"
        />

        <IntakeView v-else-if="activeTab === 'intake'" />

        <ResultsView
          v-else-if="activeTab === 'results'"
          :results="savedResults"
          @delete-result="handleDeleteResult"
          @clear-all="handleClearAllResults"
          @navigate="(tab) => (activeTab = tab)"
        />

        <BenchmarkView v-else-if="activeTab === 'benchmark'" />
        <CodeSwitchView v-else-if="activeTab === 'codeswitch'" />
        <MethodologyView v-else-if="activeTab === 'methodology'" />
        <ImpactView v-else-if="activeTab === 'impact'" />
        <EthicsView v-else-if="activeTab === 'ethics'" />
      </AppErrorBoundary>
    </main>

    <footer v-if="studioMode" class="bg-white border-t border-slate-200 py-8 mt-12 text-slate-600 text-xs">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded bg-emerald-700 flex items-center justify-center text-white">
              <Volume2 class="w-4 h-4" />
            </div>
            <div>
              <span class="font-semibold text-slate-900 text-sm">AfriVoice Studio</span>
              <span class="text-slate-400 mx-2">|</span>
              <span class="text-slate-500 text-xs">Multilingual Voice & Speech Evaluation Tool</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600">
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'home'">Home</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'generator'">Voice Generator</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'intake'">Patient Intake</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'benchmark'">Benchmark</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'codeswitch'">Code-Switching</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'methodology'">Methodology</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'impact'">Healthcare Impact</button>
            <button class="hover:text-slate-900 transition-colors" @click="activeTab = 'ethics'">Ethics & Safety</button>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
          <div class="flex items-center gap-1.5">
            <ShieldCheck class="w-3.5 h-3.5 text-slate-400" />
            <span>Public health communication & empirical evaluation utility. De-identified clinical audio.</span>
          </div>
          <div>Hausa · Igbo · Yoruba · Nigerian English · French · Spanish · Chinese · Hindi</div>
        </div>
      </div>
    </footer>

    <DiagnosticsPanel />
  </div>
</template>
