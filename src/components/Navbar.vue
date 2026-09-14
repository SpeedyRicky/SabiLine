<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Volume2,
  Activity,
  Library,
  BookOpen,
  HeartHandshake,
  ShieldCheck,
  Menu,
  X,
  Languages,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
} from 'lucide-vue-next';
import type { NavTab } from './navTabs';

const props = defineProps<{
  activeTab: NavTab;
  resultCount: number;
  providerStatus: {
    saharaConfigured: boolean;
    geminiConfigured: boolean;
  };
}>();

const emit = defineEmits<{
  (e: 'select', tab: NavTab): void;
}>();

const mobileMenuOpen = ref(false);

interface NavItem {
  id: NavTab;
  label: string;
  icon: unknown;
}

const navItems = computed<NavItem[]>(() => [
  { id: 'home', label: 'Home', icon: Languages },
  { id: 'generator', label: 'Voice Generator', icon: Volume2 },
  { id: 'intake', label: 'Patient Intake', icon: ClipboardList },
  { id: 'results', label: 'My Results', icon: Library },
  { id: 'benchmark', label: 'Benchmark', icon: Activity },
  { id: 'codeswitch', label: 'Code-Switching', icon: ArrowRightLeft },
  { id: 'methodology', label: 'Methodology', icon: BookOpen },
  { id: 'impact', label: 'Impact', icon: HeartHandshake },
  { id: 'ethics', label: 'Ethics', icon: ShieldCheck },
]);

function badgeFor(id: NavTab): string | undefined {
  return id === 'results' && props.resultCount > 0 ? String(props.resultCount) : undefined;
}

function handleSelect(tab: NavTab) {
  emit('select', tab);
  mobileMenuOpen.value = false;
}
</script>

<template>
  <header class="sticky top-0 z-40 bg-white border-b border-slate-200 text-slate-800">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-15">
        <!-- Brand Logo & Name -->
        <div
          id="brand-logo-btn"
          class="flex items-center gap-2.5 cursor-pointer select-none"
          @click="handleSelect('home')"
        >
          <div class="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center text-white">
            <Volume2 class="w-4 h-4" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-base tracking-tight text-slate-900">AfriVoice Studio</span>
              <span class="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                African Speech
              </span>
            </div>
            <p class="text-[11px] text-slate-500 hidden sm:block">
              Hausa · Igbo · Yoruba · Multilingual Audio
            </p>
          </div>
        </div>

        <!-- Desktop Navigation -->
        <nav class="hidden xl:flex items-center gap-1">
          <button
            v-for="item in navItems"
            :key="item.id"
            :id="`nav-link-${item.id}`"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            :class="activeTab === item.id
              ? 'bg-slate-100 text-slate-900 border border-slate-200 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'"
            @click="handleSelect(item.id)"
          >
            <component :is="item.icon" class="w-4 h-4" />
            <span>{{ item.label }}</span>
            <span
              v-if="badgeFor(item.id)"
              class="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-700 text-white font-semibold"
            >
              {{ badgeFor(item.id) }}
            </span>
          </button>
        </nav>

        <!-- Provider Status Indicators -->
        <div class="hidden md:flex items-center gap-2.5">
          <div
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border"
            :class="providerStatus.saharaConfigured
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-slate-50 border-slate-200 text-slate-600'"
          >
            <CheckCircle2 v-if="providerStatus.saharaConfigured" class="w-3.5 h-3.5 text-emerald-700" />
            <AlertCircle v-else class="w-3.5 h-3.5 text-slate-400" />
            <span>Sahara {{ providerStatus.saharaConfigured ? 'Ready' : 'Mock/Local' }}</span>
          </div>

          <div
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border"
            :class="providerStatus.geminiConfigured
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : 'bg-slate-50 border-slate-200 text-slate-600'"
          >
            <CheckCircle2 v-if="providerStatus.geminiConfigured" class="w-3.5 h-3.5 text-blue-700" />
            <AlertCircle v-else class="w-3.5 h-3.5 text-slate-400" />
            <span>Gemini {{ providerStatus.geminiConfigured ? 'Ready' : 'Local' }}</span>
          </div>

          <button
            id="cta-create-voice-nav"
            class="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            @click="handleSelect('generator')"
          >
            Generate Voice
          </button>
        </div>

        <!-- Mobile Hamburger Button -->
        <div class="flex xl:hidden items-center gap-2">
          <button
            id="mobile-menu-toggle"
            class="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            aria-label="Toggle Navigation Menu"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <X v-if="mobileMenuOpen" class="w-5 h-5" />
            <Menu v-else class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile Drawer -->
    <div v-if="mobileMenuOpen" class="xl:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 space-y-1">
      <button
        v-for="item in navItems"
        :key="item.id"
        :id="`mobile-nav-${item.id}`"
        class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium"
        :class="activeTab === item.id ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-50'"
        @click="handleSelect(item.id)"
      >
        <div class="flex items-center gap-2.5">
          <component :is="item.icon" class="w-4 h-4" />
          <span>{{ item.label }}</span>
        </div>
        <span
          v-if="badgeFor(item.id)"
          class="text-xs px-2 py-0.5 rounded-full bg-emerald-700 text-white font-semibold"
        >
          {{ badgeFor(item.id) }}
        </span>
      </button>

      <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
        <span>Sahara: {{ providerStatus.saharaConfigured ? 'Ready' : 'Local' }}</span>
        <span>Gemini: {{ providerStatus.geminiConfigured ? 'Ready' : 'Local' }}</span>
      </div>
    </div>
  </header>
</template>
