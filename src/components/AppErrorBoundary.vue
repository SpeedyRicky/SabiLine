<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';
import { AlertOctagon, RotateCcw } from 'lucide-vue-next';
import { logError } from '../utils/diagnostics';

const hasError = ref(false);
const errorMessage = ref('');

onErrorCaptured((err) => {
  hasError.value = true;
  errorMessage.value = err instanceof Error ? err.message : String(err);
  logError('render', err);
  // Returning false stops the error from propagating further up and crashing
  // the whole app; this boundary's fallback UI takes over instead.
  return false;
});

function reset() {
  hasError.value = false;
  errorMessage.value = '';
}
</script>

<template>
  <div v-if="hasError" class="max-w-2xl mx-auto my-10 p-6 bg-white border border-rose-200 rounded-xl shadow-xs text-center space-y-3">
    <div class="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
      <AlertOctagon class="w-5 h-5" />
    </div>
    <h3 class="text-sm font-bold text-slate-900">Something went wrong on this screen</h3>
    <p class="text-xs text-slate-600 leading-relaxed">
      {{ errorMessage || 'An unexpected error occurred while rendering this section.' }}
    </p>
    <p class="text-[11px] text-slate-500">
      This has been logged to the diagnostics panel. You can try again, or switch to a different tab.
    </p>
    <button
      class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors"
      @click="reset"
    >
      <RotateCcw class="w-3.5 h-3.5" />
      Try Again
    </button>
  </div>
  <slot v-else />
</template>
