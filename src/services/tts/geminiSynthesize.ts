import { Modality } from '@google/genai';
import { getGeminiClient } from './geminiClient';
import { pcmToWavBuffer } from './pcmToWav';
import type { LanguageCode } from '../../types';

export interface SynthesizeResult {
  success: boolean;
  audioBase64?: string;
  mimeType?: string;
  durationSec?: number;
  error?: string;
}

/**
 * Synthesizes neutral reference audio purely so the benchmark runner has a
 * real audio clip to hand to each ASR provider. This is deliberately
 * separate from the richer voice-generation call in /api/tts/generate
 * (which supports emotion/voice selection for the product feature) — the
 * benchmark only needs one consistent, neutral rendering of the ground-truth
 * transcript, reused identically across every model under comparison.
 */
export async function synthesizeReferenceAudio(text: string, language: LanguageCode): Promise<SynthesizeResult> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      success: false,
      error: 'GEMINI_API_KEY is not configured, so no reference audio can be synthesized for this benchmark run.',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: `Speak clearly and naturally in ${language}: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    });

    const rawPcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!rawPcmBase64) {
      throw new Error('Gemini model did not return audio data in candidates response.');
    }

    const pcmRawBuffer = Buffer.from(rawPcmBase64, 'base64');
    const wavBuffer = pcmToWavBuffer(pcmRawBuffer, 24000, 1, 16);
    const durationSec = Math.max(1, Math.round((pcmRawBuffer.length / (24000 * 2)) * 10) / 10);

    return {
      success: true,
      audioBase64: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
      durationSec,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gemini reference audio synthesis failed.',
    };
  }
}
