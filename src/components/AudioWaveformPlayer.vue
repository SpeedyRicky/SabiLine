<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from 'vue';
import { Play, Pause, RotateCcw, Download, Volume2, VolumeX } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    audioBase64?: string;
    audioUrl?: string;
    mimeType?: string;
    title?: string;
    language?: string;
    provider?: string;
    durationSec?: number;
    autoPlay?: boolean;
  }>(),
  {
    mimeType: 'audio/wav',
    title: 'Synthesized Healthcare Speech',
    durationSec: 5,
    autoPlay: false,
  }
);

const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const totalDuration = ref(props.durationSec);
const volume = ref(1.0);
const isMuted = ref(false);
const playbackRate = ref(1.0);
const resolvedSrc = ref('');
const loadError = ref<string | null>(null);

// Pre-generate a deterministic pseudo-random waveform bar height pattern
const waveformBars = Array.from({ length: 48 }, (_, i) => {
  const v = Math.sin(i * 0.35) * 0.35 + Math.cos(i * 0.8) * 0.25 + 0.4;
  return Math.max(0.15, Math.min(1.0, v));
});

const hasAudioSource = computed(() => Boolean(props.audioBase64 || props.audioUrl));

let currentObjectUrl: string | null = null;

function releaseObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function rebuildSource() {
  releaseObjectUrl();
  loadError.value = null;

  if (props.audioBase64) {
    try {
      const byteChars = atob(props.audioBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: props.mimeType });
      currentObjectUrl = URL.createObjectURL(blob);
      resolvedSrc.value = currentObjectUrl;
    } catch (err) {
      console.error('Failed to decode audio data', err);
      loadError.value = 'This audio clip could not be decoded. It may be corrupted or incomplete.';
      resolvedSrc.value = '';
    }
  } else if (props.audioUrl) {
    resolvedSrc.value = props.audioUrl;
  } else {
    resolvedSrc.value = '';
  }
}

watch(() => [props.audioBase64, props.audioUrl, props.mimeType], rebuildSource, { immediate: true });

onBeforeUnmount(releaseObjectUrl);

watch(resolvedSrc, async () => {
  if (resolvedSrc.value && props.autoPlay) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    audioRef.value?.play().catch(() => {
      // Browser autoplay restrictions may prevent playback; this is expected, not an error.
    });
  }
});

function togglePlay() {
  if (!audioRef.value) return;
  if (isPlaying.value) {
    audioRef.value.pause();
  } else {
    audioRef.value.play().catch((err) => {
      loadError.value = 'Playback failed to start in this browser.';
      console.error('Audio play() failed', err);
    });
  }
}

function handleTimeUpdate() {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime;
    if (audioRef.value.duration && !isNaN(audioRef.value.duration)) {
      totalDuration.value = audioRef.value.duration;
    }
  }
}

function handleSeek(e: Event) {
  const target = Number((e.target as HTMLInputElement).value);
  currentTime.value = target;
  if (audioRef.value) {
    audioRef.value.currentTime = target;
  }
}

function handleRestart() {
  if (audioRef.value) {
    audioRef.value.currentTime = 0;
    audioRef.value.play().catch(() => {});
    isPlaying.value = true;
  }
}

function handleVolumeChange(e: Event) {
  const newVol = Number((e.target as HTMLInputElement).value);
  volume.value = newVol;
  isMuted.value = newVol === 0;
  if (audioRef.value) {
    audioRef.value.volume = newVol;
  }
}

function toggleMute() {
  if (audioRef.value) {
    const nextMute = !isMuted.value;
    isMuted.value = nextMute;
    audioRef.value.muted = nextMute;
  }
}

function cyclePlaybackRate() {
  const rates = [0.85, 1.0, 1.25, 1.5];
  const nextIdx = (rates.indexOf(playbackRate.value) + 1) % rates.length;
  const nextRate = rates[nextIdx];
  playbackRate.value = nextRate;
  if (audioRef.value) {
    audioRef.value.playbackRate = nextRate;
  }
}

function downloadAudio() {
  if (!resolvedSrc.value) return;
  const link = document.createElement('a');
  link.href = resolvedSrc.value;
  const safeTitle = (props.title || 'afrivoice-speech').toLowerCase().replace(/[^a-z0-9]/g, '-');
  link.download = `${safeTitle}-${Date.now()}.wav`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatTime(secs: number) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const progressPercent = computed(() =>
  totalDuration.value > 0 ? (currentTime.value / totalDuration.value) * 100 : 0
);

function onSeekBarClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = clickX / rect.width;
  const newTime = ratio * totalDuration.value;
  currentTime.value = newTime;
  if (audioRef.value) {
    audioRef.value.currentTime = newTime;
  }
}
</script>

<template>
  <div class="bg-white border border-slate-200 rounded-lg p-4 shadow-xs text-slate-800">
    <!-- Honest empty state: no fake/dead player when there is no audio file to play -->
    <div v-if="!hasAudioSource" class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
      <strong class="text-slate-800 block mb-0.5">No audio file available.</strong>
      <span v-if="provider === 'browser'">
        This was played once locally via your device's speech synthesis and cannot be replayed, downloaded, or
        compared — device speech is not saved as an audio file.
      </span>
      <span v-else>This result has no synthesized audio to play back.</span>
    </div>

    <template v-else>
      <audio
        ref="audioRef"
        :src="resolvedSrc"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @ended="() => { isPlaying = false; currentTime = 0; }"
        @timeupdate="handleTimeUpdate"
        @loadedmetadata="() => { if (audioRef?.duration) totalDuration = audioRef.duration; }"
        @error="loadError = 'Your browser could not play this audio file.'"
      />

      <div v-if="loadError" class="mb-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
        {{ loadError }}
      </div>

      <!-- Header Info -->
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="min-w-0 flex-1">
          <h4 class="text-sm font-semibold text-slate-900 truncate">{{ title }}</h4>
          <div class="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
            <span v-if="language" class="uppercase font-semibold text-emerald-700">{{ language }}</span>
            <span v-if="provider" class="text-slate-300">·</span>
            <span v-if="provider" class="capitalize">{{ provider }}</span>
            <span class="text-slate-300">·</span>
            <span>24 kHz WAV</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="text-xs font-medium px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            title="Adjust playback speed"
            @click="cyclePlaybackRate"
          >
            {{ playbackRate }}x
          </button>

          <button
            id="download-audio-btn"
            :disabled="!resolvedSrc"
            class="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors disabled:opacity-50"
            title="Download audio file"
            @click="downloadAudio"
          >
            <Download class="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      <!-- Waveform Visualizer -->
      <div
        class="relative h-12 bg-slate-50 rounded p-2 flex items-center justify-between gap-1 overflow-hidden cursor-pointer group mb-3 border border-slate-200"
        @click="onSeekBarClick"
      >
        <div
          v-for="(heightFactor, idx) in waveformBars"
          :key="idx"
          class="flex-1 rounded-sm transition-all duration-75"
          :style="{
            height: `${Math.max(14, heightFactor * 100)}%`,
            backgroundColor: (idx / waveformBars.length) * 100 <= progressPercent ? '#1e293b' : '#cbd5e1',
          }"
        />

        <div
          class="absolute top-0 bottom-0 w-0.5 bg-slate-900 pointer-events-none transition-all duration-75"
          :style="{ left: `${progressPercent}%` }"
        />
      </div>

      <!-- Progress Slider & Timestamps -->
      <div class="space-y-1 mb-3">
        <input
          type="range"
          :min="0"
          :max="totalDuration || 1"
          step="0.01"
          :value="currentTime"
          class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-800"
          aria-label="Seek audio"
          @input="handleSeek"
        />
        <div class="flex justify-between text-xs text-slate-500 font-mono">
          <span>{{ formatTime(currentTime) }}</span>
          <span>{{ formatTime(totalDuration) }}</span>
        </div>
      </div>

      <!-- Controls Bar -->
      <div class="flex items-center justify-between pt-1 border-t border-slate-100">
        <div class="flex items-center gap-3">
          <button
            id="play-pause-btn"
            :disabled="!resolvedSrc"
            class="w-9 h-9 rounded-full bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            :aria-label="isPlaying ? 'Pause' : 'Play'"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" class="w-4 h-4 fill-current" />
            <Play v-else class="w-4 h-4 fill-current translate-x-0.5" />
          </button>

          <button
            :disabled="!resolvedSrc"
            class="p-1.5 text-slate-500 hover:text-slate-800 rounded transition-colors"
            title="Replay from start"
            aria-label="Replay"
            @click="handleRestart"
          >
            <RotateCcw class="w-4 h-4" />
          </button>
        </div>

        <!-- Volume Control -->
        <div class="flex items-center gap-2">
          <button
            class="text-slate-500 hover:text-slate-800 p-1 rounded transition-colors"
            :title="isMuted ? 'Unmute' : 'Mute'"
            @click="toggleMute"
          >
            <VolumeX v-if="isMuted || volume === 0" class="w-4 h-4" />
            <Volume2 v-else class="w-4 h-4" />
          </button>
          <input
            type="range"
            :min="0"
            :max="1"
            step="0.05"
            :value="isMuted ? 0 : volume"
            class="w-16 h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-700"
            aria-label="Audio volume"
            @input="handleVolumeChange"
          />
        </div>
      </div>
    </template>
  </div>
</template>
