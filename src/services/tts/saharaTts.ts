// Server-only. Intron Sahara text-to-speech — the only provider in this app
// with genuine Hausa/Igbo/Yoruba voices.
//
// Contract confirmed against Intron's own API docs (docs.voice.intron.io):
//
//   POST https://infer.voice.intron.io/tts/v1/generate      (synchronous)
//     { text, voice_language, voice_accent, voice_gender, output_audio_format? }
//     -> 200 { data: { audio_path, audio_duration_in_seconds, processing_status }, ... }
//     -> 503 after 120s, carrying a text_id to poll instead
//     -> 400 { data: {}, message: "invalid text voice accent,...", status: "Error" }
//   GET  https://infer.voice.intron.io/tts/v1/status/{text_id}
//     -> { data: { audio_path, audio_duration_in_seconds, processing_status }, ... }
//
// The synchronous route is used because intake replies are short and one round
// trip beats three. The asynchronous status endpoint is still implemented, as
// the documented recovery path for a 503: Sahara hands back a text_id rather
// than losing the job, so we poll it out instead of failing the turn.
//
// Note the audio is NOT in these responses — both routes return a URL that
// still has to be downloaded. And `audio_path` is present even while a job is
// still processing, so `processing_status` is the only field that may decide
// whether the audio is ready.
//
// An earlier version of this integration called a completely invented
// endpoint (api.intron.io/v1/tts/synthesize) with an invented request shape
// and assumed a synchronous raw-audio response. None of that was real; it
// could never have worked.
import type { LanguageCode } from '../../types';
import { concatWav, splitForSpeech } from './wavJoin';
import { sanitizeProviderError, scrubProviderDetail } from '../../utils/sanitizeProviderError';

/** Overridable so this can be pointed at a proxy or a local stand-in; defaults
 *  to Intron's real origin. Read per call, not once at import, so a serverless
 *  container that warm-starts before the env is applied still sees it. */
function saharaBaseUrl(): string {
  return (process.env.SAHARA_BASE_URL?.trim() || 'https://infer.voice.intron.io').replace(/\/+$/, '');
}

export function isSaharaConfigured(): boolean {
  return Boolean(process.env.SAHARA_API_KEY?.trim());
}

export class SaharaNotConfiguredError extends Error {
  constructor() {
    super('SAHARA_API_KEY is not configured, so no native African-language voice is available.');
    this.name = 'SaharaNotConfiguredError';
  }
}

/** Sahara has no voice for this language — say so rather than substituting
 *  an unrelated one. Callers fall back down the provider chain. */
export class SaharaLanguageUnsupportedError extends Error {
  constructor(language: LanguageCode) {
    super(`Sahara has no configured voice for "${language}".`);
    this.name = 'SaharaLanguageUnsupportedError';
  }
}

// Sahara treats spoken language and speaker accent as two separate axes (its
// own docs pair voice_language "en" with voice_accent "swahili" — i.e. English
// spoken in a Swahili accent).
//
// UNVERIFIED: these accent strings are inferred from that one documented
// example. Intron's supported-languages-and-accents page is not reachable from
// here, so they have not been checked against the real list. This is a
// deliberately cheap thing to correct: on a bad pair Sahara replies 400 with
// `"invalid text voice accent,{accent} not supported for language {language}"`,
// and the error thrown below quotes Sahara's own message verbatim alongside the
// exact triple that was sent — so one failed call names the fix.
//
// Fulfulde is deliberately absent: better an honest "no voice" and a
// fallback than a confidently wrong-language voice read to a patient.
//
// Pidgin IS mapped, to the same Nigerian-English voice as `en`. That is not
// a substitution for a language Sahara supports — Pidgin is an English-based
// creole whose words are overwhelmingly English, and Nigerian-accented
// English is exactly the register it is spoken in. Its own docs already pair
// voice_language "en" with a separate accent axis for this reason.
const SAHARA_VOICE_BY_LANGUAGE: Partial<Record<LanguageCode, { voice_language: string; voice_accent: string }>> = {
  yo: { voice_language: 'yo', voice_accent: 'yoruba' },
  ig: { voice_language: 'ig', voice_accent: 'igbo' },
  ha: { voice_language: 'ha', voice_accent: 'hausa' },
  en: { voice_language: 'en', voice_accent: 'nigerian' },
  pcm: { voice_language: 'en', voice_accent: 'nigerian' },
};

/** Sahara takes gender as its own field; this app encodes it in the voice id
 *  (e.g. "sahara-yo-female-1"), so it is read back out here rather than
 *  reshaping the voice catalogue the UI renders from. */
export function genderFromVoiceId(voiceId: string | undefined): 'male' | 'female' {
  return voiceId && voiceId.includes('-male') ? 'male' : 'female';
}

export interface SaharaSpeechResult {
  audioBase64: string;
  mimeType: string;
  durationSec: number;
}

interface SaharaPollOptions {
  /** Bounds the whole operation — generate call, any 503 poll loop, and the
   *  audio download. Kept well inside the Vercel function budget
   *  (vercel.json allows 60s) so the caller can still fall back to another
   *  voice and return honest JSON rather than being killed mid-request. */
  timeoutMs?: number;
  intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.SAHARA_TTS_TIMEOUT_MS) || 25000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** Longest we'll honour a Retry-After before giving up on it — a very large
 *  value from the server would otherwise blow the whole function budget. */
const MAX_RETRY_AFTER_MS = 10000;

const STATUS_DONE = 'TTS_TEXT_AUDIO_GENERATED';
const STATUS_FAILED = 'TTS_TEXT_AUDIO_PROCESSING_FAILED';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sahara sends Retry-After in seconds on a 429. Falls back to `fallbackMs`
 *  when the header is missing or unparseable. */
function retryAfterMs(res: Response, fallbackMs: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function readBody(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Sahara puts the useful part of an error in `message` (it names exactly
 *  which of language/accent/gender it rejected). Prefer it over the raw body. */
function errorDetail(body: any, status: number): string {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  // Scrubbed here, at the single point every Sahara error detail is read, so
  // no caller can forward a raw provider payload by forgetting to sanitise.
  return scrubProviderDetail(message) || `HTTP ${status}`;
}

/**
 * Sahara's documented per-request text limit is contradictory: the /generate
 * page says 4096 characters, while its own 400 sample says 100 — and the
 * streaming route caps a chunk at 100 outright. Rather than pick a side, the
 * first over-length rejection is *read* for the real number and remembered for
 * the life of the process, so at most one call is ever wasted on it.
 */
let discoveredMaxChars: number | null = null;
/** Used when a limit is known to exist but the message didn't name one. */
const FALLBACK_MAX_CHARS = 100;

function parseMaxChars(message: string): number | null {
  const match = /max limit of (\d+) characters/i.exec(message);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isTextTooLong(status: number, message: string): boolean {
  return status === 400 && /character count greater than the max limit/i.test(message);
}

/**
 * Generates speech and returns the audio.
 *
 * Long replies are synthesized in pieces and stitched back together, because
 * Sahara caps the text of a single request (see discoveredMaxChars above).
 *
 * Throws (never returns partial or substituted audio) on unsupported
 * language, auth failure, a rejected request, a failed job, or a timeout —
 * callers treat any throw as "fall back to the next voice provider".
 */
export async function synthesizeWithSahara(
  text: string,
  language: LanguageCode,
  voiceId?: string,
  opts: SaharaPollOptions = {}
): Promise<SaharaSpeechResult> {
  const apiKey = process.env.SAHARA_API_KEY?.trim();
  if (!apiKey) throw new SaharaNotConfiguredError();

  const voice = SAHARA_VOICE_BY_LANGUAGE[language];
  if (!voice) throw new SaharaLanguageUnsupportedError(language);

  const ctx: GenerateContext = {
    apiKey,
    voice,
    voiceGender: genderFromVoiceId(voiceId),
    intervalMs: opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    deadline: Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };

  // Once a real limit is known, split up front rather than re-learning it.
  const pieces =
    discoveredMaxChars !== null ? splitForSpeech(text, discoveredMaxChars) : [text.trim()];
  if (pieces.length === 0) throw new Error('There is no text to speak.');

  try {
    return await generateAll(pieces, ctx);
  } catch (err) {
    // First over-length rejection: learn the limit, then retry split. Any
    // other failure propagates untouched.
    if (!(err instanceof SaharaTextTooLongError)) throw err;
    discoveredMaxChars = err.maxChars;
    return generateAll(splitForSpeech(text, err.maxChars), ctx);
  }
}

interface GenerateContext {
  apiKey: string;
  voice: { voice_language: string; voice_accent: string };
  voiceGender: 'male' | 'female';
  intervalMs: number;
  deadline: number;
}

/** Thrown only internally, to trigger the split-and-retry above. */
class SaharaTextTooLongError extends Error {
  constructor(readonly maxChars: number) {
    super(`Sahara rejected the text as longer than its ${maxChars}-character limit.`);
    this.name = 'SaharaTextTooLongError';
  }
}

/** Synthesizes each piece in order and joins the audio into one clip.
 *  Sequential on purpose: Sahara allows 30 requests/minute, and firing a long
 *  reply's pieces in parallel is the fastest way to spend that on one patient. */
async function generateAll(pieces: string[], ctx: GenerateContext): Promise<SaharaSpeechResult> {
  const buffers: Buffer[] = [];
  let durationSec = 0;

  for (const piece of pieces) {
    const part = await generateOne(piece, ctx);
    buffers.push(part.buffer);
    durationSec += part.durationSec;
  }

  return {
    audioBase64: concatWav(buffers).toString('base64'),
    mimeType: 'audio/wav',
    durationSec: durationSec || Math.max(1.5, Math.round(pieces.join(' ').split(/\s+/).length * 0.45)),
  };
}

/** One /tts/v1/generate call, through to the downloaded audio bytes. */
async function generateOne(
  text: string,
  ctx: GenerateContext
): Promise<{ buffer: Buffer; durationSec: number }> {
  const { apiKey, voice, voiceGender, intervalMs, deadline } = ctx;

  /** Quoted in every request-shaped error so a wrong accent is a one-line fix. */
  const sent = `voice_language="${voice.voice_language}" voice_accent="${voice.voice_accent}" voice_gender="${voiceGender}"`;

  // `output_audio_format` is deliberately omitted: it defaults to WAV, and the
  // docs give the casing of the enum values only as display names. One less
  // unverified string to get wrong — and concatWav needs WAV, not OPUS.
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_language: voice.voice_language,
      voice_accent: voice.voice_accent,
      voice_gender: voiceGender,
    }),
  };

  // 1. Generate. Sahara's limit on this route is 30 requests/minute, so a 429
  //    is worth one patient retry — dropping straight to a device voice would
  //    needlessly lose the native African-language audio that is the entire
  //    point of this provider.
  let res = await fetch(`${saharaBaseUrl()}/tts/v1/generate`, init);
  if (res.status === 429) {
    await sleep(retryAfterMs(res, intervalMs));
    res = await fetch(`${saharaBaseUrl()}/tts/v1/generate`, init);
    if (res.status === 429) {
      throw new Error("Sahara's rate limit (30 requests/minute) is still exhausted after waiting — try again shortly.");
    }
  }

  let body = await readBody(res);

  // 2. A 503 is not a failure: it means generation ran past Sahara's own 120s
  //    synchronous window and the job is still running under the text_id it
  //    returns. Poll that out rather than discarding finished work.
  if (res.status === 503) {
    const textId = body?.data?.text_id ?? body?.text_id;
    if (!textId) {
      throw new Error('Sahara timed out generating the audio and returned no text_id to poll.');
    }
    body = await pollUntilGenerated(String(textId), apiKey, deadline, intervalMs);
  } else if (!res.ok) {
    const detail = errorDetail(body, res.status);
    if (isTextTooLong(res.status, detail)) {
      throw new SaharaTextTooLongError(parseMaxChars(detail) ?? FALLBACK_MAX_CHARS);
    }
    throw new Error(
      sanitizeProviderError(`Sahara rejected the request for ${sent} (HTTP ${res.status}): ${detail}`, {
        subject: 'Sahara speech synthesis',
      })
    );
  }

  // 3. Whichever route we came in by, only `processing_status` decides — the
  //    status body carries an audio_path even while still processing.
  const status = body?.data?.processing_status ?? 'unknown';
  if (status === STATUS_FAILED) {
    throw new Error('Sahara reported the speech job failed during processing.');
  }
  if (status !== STATUS_DONE) {
    throw new Error(`Sahara returned an unfinished job (status: ${status}) instead of generated audio.`);
  }

  const audioPath = body?.data?.audio_path;
  if (!audioPath) {
    throw new Error('Sahara reported the audio was generated but returned no audio_path.');
  }

  // 4. Download the finished file — neither route returns audio inline.
  const audioRes = await fetch(audioPath);
  if (!audioRes.ok) {
    throw new Error(`Could not download the generated Sahara audio (HTTP ${audioRes.status}).`);
  }
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Sahara returned an empty audio file.');
  }

  return { buffer, durationSec: Number(body?.data?.audio_duration_in_seconds) || 0 };
}

/** Polls /tts/v1/status until the job reports a terminal state, and returns
 *  that final status body. Bounded by the caller's overall deadline. */
async function pollUntilGenerated(
  textId: string,
  apiKey: string,
  deadline: number,
  intervalMs: number
): Promise<any> {
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const res = await fetch(`${saharaBaseUrl()}/tts/v1/status/${encodeURIComponent(textId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Being rate-limited mid-poll is not a failed job — wait as instructed and
    // keep polling. The overall deadline still bounds this.
    if (res.status === 429) {
      await sleep(retryAfterMs(res, intervalMs));
      continue;
    }

    const body = await readBody(res);
    if (!res.ok) {
      throw new Error(
        sanitizeProviderError(`Sahara status check failed (HTTP ${res.status}): ${errorDetail(body, res.status)}`, {
          subject: 'Sahara speech synthesis',
        })
      );
    }

    lastStatus = body?.data?.processing_status ?? 'unknown';
    if (lastStatus === STATUS_DONE || lastStatus === STATUS_FAILED) return body;

    await sleep(intervalMs);
  }

  throw new Error(`Sahara did not finish generating audio in time (last status: ${lastStatus}).`);
}

/** Test-only: forgets the learned character limit between cases. */
export function __resetSaharaLimitCache(): void {
  discoveredMaxChars = null;
}
