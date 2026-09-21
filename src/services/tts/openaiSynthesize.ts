import { openaiSynthesizeSpeech, isQuotaExceededError } from './openaiClient';
import { normalizeQuietAudio } from '../asr/audioPreprocess';
import type { LanguageCode } from '../../types';

export interface SynthesizeResult {
  success: boolean;
  audioBase64?: string;
  mimeType?: string;
  durationSec?: number;
  error?: string;
  quotaExceeded?: boolean;
  fromCache?: boolean;
}

// In-memory cache, process lifetime only. The benchmark re-synthesizes the
// exact same (text, language) reference clip every time it re-runs the same
// sample set, which needlessly burns API quota on identical output. Reusing
// the previous real result for an identical input is caching, not
// fabrication — the audio was still genuinely generated once.
const referenceAudioCache = new Map<string, SynthesizeResult>();

/**
 * Synthesizes neutral reference audio purely so the benchmark runner has a
 * real audio clip to hand to each ASR provider. This is deliberately
 * separate from the richer voice-generation call in /api/tts/generate
 * (which supports emotion/voice selection for the product feature) — the
 * benchmark only needs one consistent, neutral rendering of the ground-truth
 * transcript, reused identically across every model under comparison.
 *
 * Note: OpenAI's /audio/speech endpoint takes no language parameter — it
 * infers pronunciation from the input text alone. `language` is accepted
 * here only to keep the same call signature every caller already uses.
 */
export async function synthesizeReferenceAudio(text: string, language: LanguageCode): Promise<SynthesizeResult> {
  const cacheKey = `${language}::${text}`;
  const cached = referenceAudioCache.get(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  try {
    const { audioBase64: mp3Base64, mimeType } = await openaiSynthesizeSpeech(text);

    // Boost quiet renderings before handing this off to any ASR provider —
    // a quiet clip is more likely to be mistranscribed or hallucinated on.
    // normalizeQuietAudio expects WAV/PCM framing, so it's applied only when
    // the returned format is one it understands; mp3 output is passed
    // through unchanged rather than mis-parsed as raw PCM.
    let finalAudioBase64 = mp3Base64;
    if (mimeType === 'audio/wav') {
      const { buffer } = normalizeQuietAudio(Buffer.from(mp3Base64, 'base64'));
      finalAudioBase64 = buffer.toString('base64');
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1, Math.round(wordCount * 0.4 * 10) / 10);

    const result: SynthesizeResult = {
      success: true,
      audioBase64: finalAudioBase64,
      mimeType,
      durationSec,
    };
    referenceAudioCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : 'Reference audio synthesis failed.',
    };
  }
}
