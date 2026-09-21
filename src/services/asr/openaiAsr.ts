import { openaiTranscribeAudio, isOpenAIConfigured } from '../tts/openaiClient';
import type { SpeechModelProvider } from './types';

/**
 * Real ASR via an OpenAI-compatible Whisper transcription endpoint. Used by
 * the benchmark runner to compare this provider's raw transcription
 * accuracy against Sahara and any other configured model.
 */
export const openaiAsrProvider: SpeechModelProvider = {
  id: 'openai',
  displayName: 'OpenAI (Whisper transcription)',
  isConfigured: () => isOpenAIConfigured(),

  async transcribe(audioBase64, mimeType) {
    const start = Date.now();
    if (!isOpenAIConfigured()) {
      return { success: false, error: 'No OpenAI API key is configured.', latencyMs: Date.now() - start };
    }

    try {
      const { transcript } = await openaiTranscribeAudio(audioBase64, mimeType);
      const clean = transcript.trim();
      if (!clean) {
        return { success: false, error: 'OpenAI returned an empty transcription.', latencyMs: Date.now() - start };
      }

      return { success: true, transcript: clean, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OpenAI transcription failed.',
        latencyMs: Date.now() - start,
      };
    }
  },
};
