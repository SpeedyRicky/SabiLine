// Browser-only. Speaks text out loud using Gemini's voice generation when
// available, automatically falling back to the device's own Web Speech
// synthesis when Gemini fails (most commonly the free-tier quota being
// exhausted) so a spoken interaction never just dead-ends silently.
import type { LanguageCode } from '../../types';

export interface SpeakOutcome {
  usedProvider: 'gemini' | 'browser' | 'none';
  fallbackReason?: string;
}

function playAudioBase64(audioBase64: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Audio playback failed.'));
    audio.play().catch(reject);
  });
}

function speakWithBrowser(text: string, language: LanguageCode): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const synth = window.speechSynthesis;
    const matching = synth.getVoices().find((v) => v.lang.startsWith(language));
    if (matching) utterance.voice = matching;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

/** Speaks `text` aloud, resolving once playback has finished. */
export async function speakAloud(text: string, language: LanguageCode): Promise<SpeakOutcome> {
  try {
    const res = await fetch('/api/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, voiceId: 'gemini-kore', provider: 'gemini', emotion: 'empathic' }),
    });
    const data = await res.json();

    if (res.ok && data.success && data.audioBase64) {
      await playAudioBase64(data.audioBase64, data.mimeType || 'audio/wav');
      return { usedProvider: 'gemini' };
    }

    await speakWithBrowser(text, language);
    return { usedProvider: 'browser', fallbackReason: data.error };
  } catch (err) {
    await speakWithBrowser(text, language);
    return {
      usedProvider: 'browser',
      fallbackReason: err instanceof Error ? err.message : 'Network error contacting voice service.',
    };
  }
}
