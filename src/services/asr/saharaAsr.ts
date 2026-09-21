import { createCustomEndpointProvider } from './customEndpointAsr';

/**
 * Intron Sahara ASR (speech-to-text).
 *
 * This previously POSTed to a hard-coded https://api.intron.io/v1/asr/transcribe.
 * That host is now *known* to be fabricated: Intron's real API lives at
 * infer.voice.intron.io, and its TTS counterpart turned out to differ from the
 * invented version in every particular — different host, different path,
 * different body (see src/services/tts/saharaTts.ts, written against the real
 * documented contract). There is no reason to believe the invented ASR shape
 * was any closer, and Intron's published ASR contract is not available here.
 *
 * So rather than guess a second time, Sahara ASR is now the same
 * bring-your-own-endpoint provider as Model B / Model C: it runs only once
 * BOTH SAHARA_API_KEY and SAHARA_ASR_URL are set, and it posts the same
 * generic { audio, mimeType, language } -> { transcript } shape. Point
 * SAHARA_ASR_URL at Intron's real transcription route (or any adapter in
 * front of it) and this works; leave it unset and Sahara is honestly reported
 * as not configured and excluded from benchmark averages — never zero-filled,
 * never fabricated.
 *
 * Requiring the URL is not cosmetic. LIVE_ASR_PRIORITY tries Sahara FIRST on
 * every spoken intake turn, so if a key alone re-enabled a hard-coded dead
 * host, simply adding SAHARA_API_KEY would put a DNS failure in front of
 * every single turn before falling through to the working provider.
 */
export const saharaAsrProvider = createCustomEndpointProvider(
  'sahara',
  'Intron Sahara',
  'SAHARA_API_KEY',
  'SAHARA_ASR_URL'
);
