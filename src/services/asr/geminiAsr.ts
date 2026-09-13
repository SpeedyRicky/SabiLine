import { getGeminiClient } from '../tts/geminiClient';
import type { SpeechModelProvider } from './types';

/**
 * Real ASR via Gemini's multimodal audio understanding: the audio clip is
 * sent as an inlineData part alongside a transcription instruction, and the
 * model's text response is used as the hypothesis transcript.
 */
export const geminiAsrProvider: SpeechModelProvider = {
  id: 'gemini',
  displayName: 'Google Gemini (audio transcription)',
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),

  async transcribe(audioBase64, mimeType, language) {
    const start = Date.now();
    const ai = getGeminiClient();
    if (!ai) {
      return { success: false, error: 'GEMINI_API_KEY is not configured.', latencyMs: Date.now() - start };
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            parts: [
              {
                text: `Transcribe the following ${language} audio exactly as spoken, including any code-switching between languages. Output ONLY the raw transcription text — no commentary, no quotation marks, no formatting.`,
              },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
      });

      const transcript = (response.text || '').trim();
      if (!transcript) {
        return { success: false, error: 'Gemini returned an empty transcription.', latencyMs: Date.now() - start };
      }

      return { success: true, transcript, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Gemini transcription failed.',
        latencyMs: Date.now() - start,
      };
    }
  },
};
