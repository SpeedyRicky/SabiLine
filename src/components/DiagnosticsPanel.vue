<script setup lang="ts">
import { ref } from 'vue';
import { Bug, Copy, Check, Trash2, ChevronDown, ChevronUp } from 'lucide-vue-next';
import { diagnosticsLog, clearDiagnostics, formatDiagnosticsReport } from '../utils/diagnostics';

const expanded = ref(false);
const copied = ref(false);
const copyFailed = ref(false);

async function copyReport() {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(formatDiagnosticsReport());
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copyFailed.value = true;
  }
}
</script>

<template>
  <div v-if="diagnosticsLog.length > 0" class="fixed bottom-3 right-3 z-50 max-w-sm">
    <div class="bg-white border border-rose-200 rounded-lg shadow-lg overflow-hidden">
      <button
        class="w-full flex items-center justify-between gap-2 px-3 py-2 bg-rose-50 text-rose-800 text-xs font-semibold"
        @click="expanded = !expanded"
      >
        <span class="flex items-center gap-1.5">
          <Bug class="w-3.5 h-3.5" />
          {{ diagnosticsLog.length }} issue{{ diagnosticsLog.length === 1 ? '' : 's' }} detected this session
        </span>
        <ChevronUp v-if="expanded" class="w-3.5 h-3.5" />
        <ChevronDown v-else class="w-3.5 h-3.5" />
      </button>

      <div v-if="expanded" class="p-3 space-y-2 max-h-64 overflow-y-auto text-xs text-slate-700">
        <div
          v-for="entry in diagnosticsLog.slice(0, 10)"
          :key="entry.id"
          class="p-2 bg-slate-50 border border-slate-200 rounded"
        >
          <div class="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
            <span class="font-mono">{{ entry.source }}</span>
            <span>{{ new Date(entry.timestamp).toLocaleTimeString() }}</span>
          </div>
          <p class="text-slate-800 break-words">{{ entry.message }}</p>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button
            class="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
            @click="copyReport"
          >
            <Check v-if="copied" class="w-3 h-3 text-emerald-600" />
            <Copy v-else class="w-3 h-3" />
            {{ copied ? 'Copied' : 'Copy report' }}
          </button>
          <button
            class="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
            @click="clearDiagnostics"
          >
            <Trash2 class="w-3 h-3" />
            Clear
          </button>
        </div>
        <p v-if="copyFailed" class="text-rose-600">Clipboard access was blocked by the browser.</p>
      </div>
    </div>
  </div>
</template>
