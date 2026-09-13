<script setup lang="ts">
import { Stethoscope, AlertCircle, Baby, HeartPulse, Pill, ArrowRightLeft } from 'lucide-vue-next';
import { HEALTHCARE_PRESETS, type HealthcarePreset } from '../services/tts/presets';

defineEmits<{ (e: 'select', preset: HealthcarePreset): void }>();

function categoryIcon(category: HealthcarePreset['category']) {
  switch (category) {
    case 'maternal':
      return Baby;
    case 'cardiology':
      return HeartPulse;
    case 'malaria':
      return AlertCircle;
    case 'pharmacy':
      return Pill;
    case 'codeswitch':
      return ArrowRightLeft;
    default:
      return Stethoscope;
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between text-xs text-slate-500">
      <span class="font-semibold text-slate-700">Healthcare Communication Templates:</span>
      <span class="text-[11px]">Click to load text</span>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <button
        v-for="preset in HEALTHCARE_PRESETS"
        :key="preset.id"
        :id="`preset-btn-${preset.id}`"
        type="button"
        class="text-left p-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors shadow-2xs group"
        @click="$emit('select', preset)"
      >
        <div class="flex items-center gap-1.5 mb-1">
          <component :is="categoryIcon(preset.category)" class="w-3.5 h-3.5" :class="{
            'text-rose-600': preset.category === 'maternal',
            'text-red-600': preset.category === 'cardiology',
            'text-amber-600': preset.category === 'malaria',
            'text-blue-600': preset.category === 'pharmacy',
            'text-emerald-700': preset.category === 'codeswitch',
            'text-slate-600': preset.category !== 'maternal' && preset.category !== 'cardiology' && preset.category !== 'malaria' && preset.category !== 'pharmacy' && preset.category !== 'codeswitch',
          }" />
          <span class="text-xs font-semibold text-slate-800 group-hover:text-slate-950 transition-colors truncate">
            {{ preset.title }}
          </span>
        </div>
        <p class="text-[11px] text-slate-500 line-clamp-2 leading-tight">{{ preset.description }}</p>
      </button>
    </div>
  </div>
</template>
