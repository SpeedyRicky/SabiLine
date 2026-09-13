<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2, ShieldAlert, Cpu } from 'lucide-vue-next';
import type { ProviderCapability } from '../types';

const props = defineProps<{
  providers: Record<string, ProviderCapability>;
}>();

const sahara = computed(() => props.providers.sahara);
const gemini = computed(() => props.providers.gemini);
</script>

<template>
  <div class="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 text-slate-800 shadow-xs">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Cpu class="w-4 h-4 text-slate-600 flex-shrink-0" />
        <div>
          <h4 class="text-xs font-bold text-slate-900">Speech Engine Status</h4>
          <p class="text-[11px] text-slate-500">
            Provider credentials and speech capabilities configured for this workspace.
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <div
          class="flex items-center gap-1.5 px-2.5 py-1 rounded border"
          :class="sahara?.isConfigured
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-900'"
        >
          <CheckCircle2 v-if="sahara?.isConfigured" class="w-3.5 h-3.5 text-emerald-700" />
          <AlertTriangle v-else class="w-3.5 h-3.5 text-amber-600" />
          <span><strong>Sahara:</strong> {{ sahara?.isConfigured ? 'Connected' : 'Local Fallback' }}</span>
        </div>

        <div
          class="flex items-center gap-1.5 px-2.5 py-1 rounded border"
          :class="gemini?.isConfigured
            ? 'bg-blue-50 border-blue-200 text-blue-800'
            : 'bg-amber-50 border-amber-200 text-amber-900'"
        >
          <CheckCircle2 v-if="gemini?.isConfigured" class="w-3.5 h-3.5 text-blue-700" />
          <AlertTriangle v-else class="w-3.5 h-3.5 text-amber-600" />
          <span><strong>Gemini 3.1:</strong> {{ gemini?.isConfigured ? 'Ready' : 'Local Mode' }}</span>
        </div>

        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded border bg-slate-50 border-slate-200 text-slate-700">
          <CheckCircle2 class="w-3.5 h-3.5 text-slate-500" />
          <span><strong>Device Voice:</strong> Available</span>
        </div>
      </div>
    </div>

    <div v-if="!sahara?.isConfigured" class="mt-2.5 pt-2 border-t border-slate-100 text-[11px] text-slate-600 flex items-start gap-1.5">
      <ShieldAlert class="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
      <span>
        <strong>Sahara Integration:</strong> To synthesize using Intron Sahara's native African models, provide
        <code class="text-slate-800 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">SAHARA_API_KEY</code>.
        Gemini voice and browser speech synthesis remain ready to generate audio.
      </span>
    </div>
  </div>
</template>
