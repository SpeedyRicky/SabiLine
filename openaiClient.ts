// Server-only. Never import this from a .vue file or any client bundle path
// — it reads process.env directly.
//
// IMPORTANT HISTORY: this file used to default to a self-hosted origin
// (a Render deployment of this app's own frontend) under the mistaken
// belief that it was an OpenAI-compatible proxy. It was not — every GET to
// it returned this app's own index.html (a SPA catch-all), and every POST
// to a chat/completions-shaped path 404'd with Express's own "Cannot POST"
// page. That is why the default origin below is the real api.openai.com,
// never a hostname owned by this project (see the regression test in
// openaiClient.test.ts asserting exactly that).
import type { LanguageCode } from '../../types';
import { sanitizeProviderError, scrubInfrastructure } from '../../utils/sanitizeProviderError';

// Every one of these env vars is tried, in this order, as long as it's set.
// The first is the account's primary key; the rest are backups for when it
// hits a rate limit, runs out of quota, or is rejected as invalid.
//
// GROQ_APIKEY (and its earlier misspelled variants GROKK_APIKEY /
// GROK_APIKEY / GROOK_APIKEY, kept for compatibility with whatever was set
// before the spelling was corrected) are Groq keys — Groq exposes an
// OpenAI-compatible chat API (see DEFAULT_ORIGIN / OPENAI_BASE_URL below).
// Mixing providers in one fallback list only works when OPENAI_BASE_URL is
// pointed at whichever provider these keys actually belong to: a key tried
// against the wrong origin harmlessly fails with a key-level error (401)
// and the chain moves on to the next one, but nothing here succeeds until
// the origin matches. See CHAT_MODEL below too — Groq doesn't recognize
// OpenAI's model names, so that also needs to be set for a Groq origin.
const OPENAI_KEY_ENV_VARS = [
  'OPEN_AI_KEY',
  'OPENAI_API_KEY',
  'SOPENAI_APIKEY',
  'TOPENAI_APIKEY',
  'FOPENAI_APIKEY',
  'GROQ_APIKEY',
  'GROKK_APIKEY',
  'GROK_APIKEY',
  'GROOK_APIKEY',
];

// The real OpenAI API. Overridable via OPENAI_BASE_URL for a genuinely
// OpenAI-compatible self-hosted proxy — never assume an override is correct
// without verifying it actually answers JSON (see OriginMisconfiguredError
// below). Normalized to a bare origin (no trailing "/v1") regardless of
// whether the configured value includes it, so path candidates below (which
// already start with "/v1/...") never end up doubled into "/v1/v1/...".
const DEFAULT_ORIGIN = 'https://api.openai.com/v1';

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function getOpenAIOrigin(): string {
  return normalizeOrigin(process.env.OPENAI_BASE_URL?.trim() || DEFAULT_ORIGIN);
}

/**
 * All configured keys, in fallback order. Trimmed (a key pasted into a
 * dashboard field can pick up a trailing newline) and de-duplicated in case
 * the same value was set under more than one variable name.
 */
export function getOpenAIKeys(): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const envVar of OPENAI_KEY_ENV_VARS) {
    const raw = process.env[envVar]?.trim();
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      keys.push(raw);
    }
  }
  return keys;
}

export function isOpenAIConfigured(): boolean {
  return getOpenAIKeys().length > 0;
}

export class OpenAINotConfiguredError extends Error {
  constructor() {
    super(
      'No API key is configured. Set OPEN_AI_KEY (and optionally SOPENAI_APIKEY / TOPENAI_APIKEY / FOPENAI_APIKEY, or GROQ_APIKEY for a Groq origin, as backups).'
    );
    this.name = 'OpenAINotConfiguredError';
  }
}

// A 401/403 means this specific key is invalid or revoked; a 429 means it's
// rate-limited or out of quota. Both are reasons to try the *next* key
// rather than fail the whole request — that is the entire point of having
// backup keys configured. Any other status is a real error worth surfacing
// immediately rather than burning through every remaining key on it.
function isKeyLevelFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export function isQuotaExceededError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('429') || message.includes('insufficient_quota') || message.includes('rate_limit');
}

export class OpenAITimeoutError extends Error {
  constructor(message = 'OpenAI took too long to respond.') {
    super(message);
    this.name = 'OpenAITimeoutError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof OpenAITimeoutError;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Vercel kills a serverless function once it hits the platform's execution
 * limit, and the response is the *platform's* error page, not anything our
 * own Express error handling gets a chance to touch. Racing every call
 * against a timeout comfortably under that limit means our own code is
 * always what responds, in valid JSON either way.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new OpenAITimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// A single tunable base: chat completions use it directly, transcription
// (audio upload + processing, generally slower) gets 1.5x it. vercel.json
// sets api/index.js's maxDuration to 60s, so even the worst case of one
// transcription call followed by one chat completion call comfortably fits
// inside the platform limit with this default.
const BASE_TIMEOUT_MS = Number(process.env.OPENAI_CALL_TIMEOUT_MS) || 20000;
export const OPENAI_CHAT_TIMEOUT_MS = BASE_TIMEOUT_MS;
export const OPENAI_TRANSCRIBE_TIMEOUT_MS = Math.round(BASE_TIMEOUT_MS * 1.5);

// Model identifiers are provider-specific — OpenAI's "gpt-4o-mini" doesn't
// exist on Groq (which uses names like "llama-3.3-70b-versatile"), and the
// same is true of the transcription/speech model names below. Overridable
// per category so pointing OPENAI_BASE_URL at a different OpenAI-compatible
// provider doesn't require a code change; defaults are unchanged from what
// this app always sent to the real OpenAI API.
const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1';
// 'tts-1' is a retired OpenAI model name; a rejection here is what the
// auto-select-and-retry path in requestOpenAICompatible() recovers from, so
// this only needs to be a name some real provider actually serves.
const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts';

/**
 * A model chosen automatically after the configured one was rejected — see
 * recoverFromDeadModel(). It deliberately outranks the env var: once the
 * provider has said in so many words that the configured model no longer
 * exists, continuing to send it would fail every single call.
 */
const autoSelectedModel: Record<EndpointCategory, string | null> = {
  chat: null,
  transcribe: null,
  speech: null,
};

function getChatModel(): string {
  return autoSelectedModel.chat || process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}
function getTranscribeModel(): string {
  return autoSelectedModel.transcribe || process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL;
}
function getSpeechModel(): string {
  return autoSelectedModel.speech || process.env.OPENAI_SPEECH_MODEL?.trim() || DEFAULT_SPEECH_MODEL;
}

/** Which model each category is really sending right now, and whether that was
 *  the operator's choice or this module's. Surfaced by /api/providers/status so
 *  a substitution is visible rather than silent. */
export function getActiveModels(): Record<EndpointCategory, { model: string; autoSelected: boolean }> {
  return {
    chat: { model: getChatModel(), autoSelected: autoSelectedModel.chat !== null },
    transcribe: { model: getTranscribeModel(), autoSelected: autoSelectedModel.transcribe !== null },
    speech: { model: getSpeechModel(), autoSelected: autoSelectedModel.speech !== null },
  };
}

async function errorTextOf(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}

class KeyLevelError extends Error {}
class PathNotFoundError extends Error {}

/**
 * The endpoint exists and answered — it is the *model* that doesn't.
 *
 * OpenAI-compatible APIs overload 404 for two unrelated causes: an unknown
 * URL, and an unknown or decommissioned model. Treating the second as the
 * first is actively harmful: it burns every remaining path candidate on
 * requests that were always going to fail, poisons the ruled-out-path cache
 * against paths that are perfectly correct, and then reports "no matching
 * endpoint found ... set OPENAI_CHAT_PATH", pointing at the one setting that
 * cannot possibly fix it. So this is never retried and never cached — it is
 * surfaced immediately, quoting the provider's own words.
 */
export class ModelNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelNotAvailableError';
  }
}

/**
 * Picks a replacement when the configured model is gone.
 *
 * The provider is the only authority on what it serves today, and it already
 * publishes that list at /v1/models. Hardcoding a "known good" name just moves
 * the breakage to the next deprecation — Groq retired llama-3.3-70b-versatile
 * on 2026-08-16 and took this app's intake flow down with it, and whatever we
 * pinned in its place would age exactly the same way. So the list is fetched
 * live and scored.
 *
 * Ordering is a preference, not a whitelist: an unrecognized id still scores
 * above nothing, so a provider we have never heard of still works.
 */
const MODEL_RANKING: Record<EndpointCategory, { prefer: RegExp[]; exclude: RegExp }> = {
  chat: {
    prefer: [
      /^gpt-4o-mini$/i,
      /^gpt-4o$/i,
      /gpt-oss-120b/i,
      /gpt-oss/i,
      /llama-?4.*(maverick|scout)/i,
      /llama.*70b/i,
      /qwen.*(3|2\.5)/i,
      /llama.*8b.*instant/i,
      /gemma/i,
      /mixtral/i,
    ],
    // Speech, embedding and safety models answer /v1/models too, and none of
    // them can hold a conversation.
    exclude: /whisper|tts|audio|speech|embed|guard|moderat|rerank|vision|image|dall-?e|playai/i,
  },
  transcribe: {
    // large-v3 over turbo on purpose: this is clinical intake in Hausa, Igbo,
    // Yoruba and Pidgin, where accuracy matters more than latency.
    prefer: [/whisper-large-v3$/i, /whisper-large/i, /whisper/i, /transcrib/i],
    exclude: /tts|embed|guard|moderat/i,
  },
  speech: {
    prefer: [/^tts-1$/i, /tts/i, /speech/i],
    exclude: /whisper|transcrib|embed|guard|moderat/i,
  },
};

/** Live model list per origin. Short TTL: long enough that a burst of failing
 *  calls costs one lookup, short enough to notice a provider adding a model. */
const MODEL_LIST_TTL_MS = 300_000;
let modelListCache: { origin: string; ids: string[]; fetchedAt: number } | null = null;

async function fetchModelIds(origin: string, apiKey: string): Promise<string[]> {
  if (modelListCache && modelListCache.origin === origin && Date.now() - modelListCache.fetchedAt < MODEL_LIST_TTL_MS) {
    return modelListCache.ids;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = await res.json();
    const ids = Array.isArray(body?.data)
      ? body.data.map((m: any) => String(m?.id ?? '')).filter(Boolean)
      : [];
    modelListCache = { origin, ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    return []; // the caller reports the original model error, not this one
  } finally {
    clearTimeout(timer);
  }
}

function chooseModel(category: EndpointCategory, ids: string[]): string | null {
  const { prefer, exclude } = MODEL_RANKING[category];
  const usable = ids.filter((id) => !exclude.test(id));
  if (usable.length === 0) return null;

  for (const pattern of prefer) {
    const match = usable.find((id) => pattern.test(id));
    if (match) return match;
  }
  // Nothing recognized, but the provider serves *something* for this category.
  // Only chat can safely take an unknown id: an arbitrary model will attempt a
  // conversation, whereas guessing at transcription or speech would send audio
  // to something that cannot handle it.
  return category === 'chat' ? usable[0] : null;
}

/** Decides which of the two a 404 body describes. Defaults to "path", so an
 *  unrecognized 404 keeps the old discovery behaviour rather than dead-ending
 *  a genuinely misconfigured path. */
function isModelLevel404(errorText: string): boolean {
  const text = errorText.toLowerCase();
  // An explicitly-named unknown URL is a path problem, whatever else it says.
  if (text.includes('unknown_url') || text.includes('unknown request url')) return false;
  if (text.includes('model_not_found') || text.includes('model_decommissioned')) return true;
  return (
    text.includes('model') &&
    /does not exist|decommissioned|not found|no longer|unsupported|deprecated/.test(text)
  );
}

// Thrown when the configured origin answers, but not as an OpenAI-compatible
// API would — most concretely, a 200 OK whose body is an HTML page (e.g. a
// single-page app's own catch-all route) instead of JSON. This must never be
// treated as "path not found" (that would trigger useless path-guessing
// against a server that was never going to have the right route at any
// path) or silently parsed as if it were real data.
export class OriginMisconfiguredError extends Error {}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * Reads a response that is expected to be a genuine JSON API reply, and
 * throws an actionable OriginMisconfiguredError if it's actually an HTML
 * page (or anything else that isn't valid JSON) — the exact shape of
 * response a misconfigured OPENAI_BASE_URL pointed at a web app, rather
 * than a real OpenAI-compatible API, would return.
 */
async function assertGenuineJsonResponse(res: Response, label: string, url: string): Promise<any> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();

  if (!contentType.includes('application/json') || looksLikeHtml(rawText)) {
    throw new OriginMisconfiguredError(
      `${label}: the server is not an OpenAI-compatible API — it returned an HTML page instead of JSON. Check OPENAI_BASE_URL in your deployment's environment settings.`
    );
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new OriginMisconfiguredError(
      `${label}: the server at ${url} returned a response that could not be parsed as JSON. Check OPENAI_BASE_URL in your deployment's environment settings.`
    );
  }
}

type EndpointCategory = 'chat' | 'transcribe' | 'speech';

// Path conventions actually used by real OpenAI-compatible servers in the
// wild: the official /v1/... shape first (this is what the real
// api.openai.com uses, so with the default origin the very first candidate
// always succeeds and nothing else is ever probed), then the same routes
// without the version prefix and behind an /api mount, for a self-hosted
// proxy that doesn't follow the standard layout.
const CHAT_COMPLETIONS_PATHS = ['/v1/chat/completions', '/chat/completions', '/api/v1/chat/completions', '/api/chat/completions'];
const TRANSCRIPTIONS_PATHS = ['/v1/audio/transcriptions', '/audio/transcriptions', '/api/v1/audio/transcriptions', '/api/audio/transcriptions'];
const SPEECH_PATHS = ['/v1/audio/speech', '/audio/speech', '/api/v1/audio/speech', '/api/audio/speech'];

// Lets a deployment skip path discovery entirely by naming the exact route
// on its OPENAI_BASE_URL — useful for a self-hosted proxy with a
// non-standard layout that isn't in the candidate lists above.
const PATH_OVERRIDE_ENV: Record<EndpointCategory, string> = {
  chat: 'OPENAI_CHAT_PATH',
  transcribe: 'OPENAI_TRANSCRIBE_PATH',
  speech: 'OPENAI_SPEECH_PATH',
};

const MODEL_ENV: Record<EndpointCategory, string> = {
  chat: 'OPENAI_CHAT_MODEL',
  transcribe: 'OPENAI_TRANSCRIBE_MODEL',
  speech: 'OPENAI_SPEECH_MODEL',
};

function getPathOverride(category: EndpointCategory): string | null {
  const raw = process.env[PATH_OVERRIDE_ENV[category]]?.trim();
  if (!raw) return null;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

// Module-level: persists for the lifetime of a warm serverless container, so
// a cold start pays for path discovery once and every later invocation on
// that same container skips straight to the known-good route. A ruled-out
// path is remembered too, but only for NEGATIVE_CACHE_TTL_MS — a permanent
// negative cache would mean one transient 404 (a cold start, a mid-flight
// deploy) disables a real route for the rest of that container's life,
// which on Vercel can be a long time.
const resolvedPath: Partial<Record<EndpointCategory, string>> = {};
const ruledOutPaths: Record<EndpointCategory, Map<string, number>> = { chat: new Map(), transcribe: new Map(), speech: new Map() };
const NEGATIVE_CACHE_TTL_MS = 60_000;
const DISCOVERY_PROBE_TIMEOUT_MS = 6000;

function isRuledOut(category: EndpointCategory, path: string): boolean {
  const ts = ruledOutPaths[category].get(path);
  if (ts === undefined) return false;
  if (Date.now() - ts > NEGATIVE_CACHE_TTL_MS) {
    ruledOutPaths[category].delete(path);
    return false;
  }
  return true;
}

// If the configured *origin* changes underneath a warm container (e.g.
// OPENAI_BASE_URL was updated and the platform reused the container rather
// than cold-starting), every cached path is invalidated rather than kept
// pointed at what the *previous* origin resolved to. Deliberately keyed on
// origin only, not the key set: rotating which key is primary, or adding a
// backup key, doesn't change which path is correct on the server, so it
// must not force path rediscovery.
let cacheFingerprint: string | null = null;
function ensureFreshCache(origin: string): void {
  const fingerprint = origin;
  if (cacheFingerprint !== null && cacheFingerprint !== fingerprint) {
    (Object.keys(resolvedPath) as EndpointCategory[]).forEach((k) => delete resolvedPath[k]);
    Object.values(ruledOutPaths).forEach((m) => m.clear());
  }
  cacheFingerprint = fingerprint;
}

/**
 * Runs `attempt` once per (path candidate × configured key), stopping at the
 * first call that isn't a 404 (path found) and isn't a key-level failure
 * (401/403/429 — try the next key on the *same*, now-confirmed path). Any
 * other failure (network error, 500, OriginMisconfiguredError) is NOT
 * retried — that kind of failure is neither the path's fault nor the key's,
 * and retrying it repeatedly would only add latency before the same honest
 * error.
 *
 * Path discovery is sequential, not concurrent: with the real OpenAI origin
 * as the default, the very first candidate always succeeds, so this only
 * matters for a self-hosted proxy where the true path is unknown — and
 * probing sequentially means a real chat-completion or transcription
 * endpoint is never called more than once per candidate concurrently
 * (a genuine cost/correctness concern once the origin is a real, billable
 * API rather than a fake one that never worked at all).
 */
/**
 * Runs a call, and if the provider rejects the *model*, asks it what it does
 * serve, picks one, and runs the call again.
 *
 * This is what keeps the app alive across a deprecation. A retired model is
 * not a transient error — every subsequent call fails identically until a
 * human edits an env var and redeploys, which for this app meant patient
 * intake was simply down. One substitution recovers it in-process.
 *
 * Bounded to a single substitution per category per container: if the chosen
 * replacement is also rejected, that is a real failure and is reported, never
 * an endless walk down the model list.
 */
async function requestOpenAICompatible<T>(
  category: EndpointCategory,
  pathCandidates: string[],
  attempt: (url: string, apiKey: string, signal?: AbortSignal) => Promise<T>
): Promise<T> {
  try {
    return await attemptWithPathAndKeyFallback(category, pathCandidates, attempt);
  } catch (err) {
    if (!(err instanceof ModelNotAvailableError) || autoSelectedModel[category] !== null) throw err;

    const keys = getOpenAIKeys();
    const origin = getOpenAIOrigin();
    const available = await fetchModelIds(origin, keys[0]);
    const replacement = chooseModel(category, available);

    if (!replacement) {
      const listed = available.length
        ? `The provider lists: ${available.slice(0, 40).join(', ')}.`
        : 'The provider did not return a usable model list either.';
      // `err.message` is already sanitised by classifyFailure; `listed` is
      // model ids this app read out of the provider's own list, scrubbed
      // lightly rather than heavily so long real names survive.
      throw new ModelNotAvailableError(scrubInfrastructure(`${err.message} ${listed}`));
    }

    autoSelectedModel[category] = replacement;
    console.warn(
      `[openai] ${category} model was rejected by ${origin}; automatically switched to "${replacement}". ` +
        `Set ${MODEL_ENV[category]} to pin a different one.`
    );
    return attemptWithPathAndKeyFallback(category, pathCandidates, attempt);
  }
}

/** Builds the "nothing worked" message. Quotes the provider's own last 404
 *  body: a generic "set OPENAI_CHAT_PATH" sent people to the wrong setting
 *  when the real answer was sitting in the response all along. */
function notFoundMessage(
  category: EndpointCategory,
  origin: string,
  pathCandidates: string[],
  lastNotFound: string | null
): string {
  // `origin` is accepted but deliberately NOT interpolated into the returned
  // message: this string reaches the patient. It is logged instead, so the
  // operator still sees exactly which origin was probed.
  const detail = lastNotFound ? ` Last response: ${sanitizeProviderError(lastNotFound)}` : '';
  console.error(`[openai] ${category}: no matching endpoint found on ${origin} — tried ${pathCandidates.join(', ')}.${detail}`);
  return (
    `${category}: no matching endpoint found on the configured API base URL — tried ` +
    `${pathCandidates.join(', ')}, all returned 404.${detail} If the path is right, check ` +
    `${MODEL_ENV[category]}; otherwise set ${PATH_OVERRIDE_ENV[category]} to the correct path.`
  );
}

async function attemptWithPathAndKeyFallback<T>(
  category: EndpointCategory,
  pathCandidates: string[],
  attempt: (url: string, apiKey: string, signal?: AbortSignal) => Promise<T>
): Promise<T> {
  const keys = getOpenAIKeys();
  if (keys.length === 0) throw new OpenAINotConfiguredError();
  const origin = getOpenAIOrigin();
  ensureFreshCache(origin);

  const override = getPathOverride(category);
  if (override) resolvedPath[category] = override;

  let keysToTry = keys;
  let lastErr: unknown;

  if (!resolvedPath[category]) {
    const candidates = pathCandidates.filter((p) => !isRuledOut(category, p));
    if (candidates.length === 0) {
      throw new Error(notFoundMessage(category, origin, pathCandidates, null));
    }

    let existingPath: string | null = null;
    let lastNotFound: string | null = null;
    for (const path of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DISCOVERY_PROBE_TIMEOUT_MS);
      try {
        const result = await attempt(origin + path, keys[0], controller.signal);
        resolvedPath[category] = path;
        return result;
      } catch (err) {
        if (err instanceof PathNotFoundError) {
          ruledOutPaths[category].set(path, Date.now());
          lastNotFound = err.message;
        } else if (err instanceof KeyLevelError) {
          // A path that exists but rejected this key still tells us which
          // path is real — prefer that over concluding "not found" while an
          // untried key might work on it.
          if (existingPath === null) {
            existingPath = path;
            lastErr = err;
          }
        } else if (isAbortError(err)) {
          lastErr = lastErr ?? new OpenAITimeoutError(`${category} probe of ${path} timed out.`);
          // Don't rule the path out permanently on a timeout — it may just
          // have been a slow cold start; try the next candidate now and let
          // this one be reconsidered on a later call.
        } else {
          // A model-level rejection proves this path exists — the request got
          // far enough to be judged on its body. Remember it so the retry with
          // a substituted model doesn't re-probe from the top.
          if (err instanceof ModelNotAvailableError) resolvedPath[category] = path;
          throw err; // a genuine error (network failure, misconfigured origin) — surface immediately
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (!existingPath) {
      throw lastErr ?? new Error(notFoundMessage(category, origin, pathCandidates, lastNotFound));
    }
    resolvedPath[category] = existingPath;
    keysToTry = keys.slice(1); // key[0] already failed against this exact path above
  }

  // Path is known (just resolved above, or cached from an earlier call) —
  // plain sequential key fallback against that one confirmed URL.
  const url = origin + resolvedPath[category]!;
  for (const key of keysToTry) {
    try {
      return await attempt(url, key);
    } catch (err) {
      lastErr = err;
      if (err instanceof KeyLevelError) continue;
      throw err; // real error — surface immediately, no rotation
    }
  }
  throw lastErr;
}

function classifyFailure(res: Response, errorText: string, label: string, category: EndpointCategory): never {
  // 404 is the common shape, but some OpenAI-compatible servers reject an
  // unknown model with 400 instead. The body, not the status, is what says so.
  // Classification reads the RAW body — isModelLevel404() has to see the
  // provider's own wording to tell "bad model" from "bad path". Only the
  // thrown message is sanitised, and never the other way round.
  if (res.status === 404 || res.status === 400) {
    if (isModelLevel404(errorText)) {
      throw new ModelNotAvailableError(
        `${sanitizeProviderError(errorText, { subject: label })} Set ${MODEL_ENV[category]} to a model this provider actually serves.`
      );
    }
    if (res.status === 404) {
      throw new PathNotFoundError(sanitizeProviderError(errorText, { subject: `${label} (HTTP 404)` }));
    }
  }
  // The full raw body still goes to the server log, so sanitising the
  // client-facing string costs the operator nothing: the provider's own
  // wording is one `console.error` away instead of on the patient's screen.
  console.error(`[openai] ${label} HTTP ${res.status}: ${errorText}`);

  if (isKeyLevelFailure(res.status)) {
    throw new KeyLevelError(sanitizeProviderError(errorText, { subject: `${label} (HTTP ${res.status})` }));
  }
  throw new Error(sanitizeProviderError(errorText, { subject: `${label} (HTTP ${res.status})` }));
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  jsonResponse?: boolean;
}

/**
 * One chat completion call. Powers the intake conversation, typed-text
 * language detection, translation, and the QA judge.
 */
export async function openaiChatCompletion(messages: ChatMessage[], opts: ChatCompletionOptions = {}): Promise<string> {
  return requestOpenAICompatible('chat', CHAT_COMPLETIONS_PATHS, async (url, apiKey, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: opts.model || getChatModel(),
        messages,
        ...(opts.jsonResponse ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    });

    // Deliberately no origin in the label: this string reaches the patient.
    const label = 'Chat completion';
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, 'chat');

    const data = await assertGenuineJsonResponse(res, label, url);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`${label} returned no message content.`);
    }
    return content;
  });
}

export interface TranscribeResult {
  transcript: string;
  /** Whatever the model reports as the spoken language — a free-text guess
   *  (e.g. "english"), not one of this app's LanguageCode values. Callers
   *  must map it themselves. */
  detectedLanguageRaw?: string;
}

export interface TranscribeOptions {
  /** Whisper's own `language` hint — only passed through for languages
   *  Whisper actually recognizes as an ISO-639-1 code (see
   *  WHISPER_LANGUAGE_MAP); Nigerian Pidgin and Fulfulde aren't in that set,
   *  so this is omitted for them and Whisper auto-detects instead. */
  languageHint?: LanguageCode;
  /** Whisper's `prompt` field — a short vocabulary nudge, not a transcript
   *  seed. Domain-specific (e.g. clinic vocabulary) hints belong here,
   *  supplied by the caller rather than hardcoded in this generic client. */
  prompt?: string;
}

const WHISPER_LANGUAGE_MAP: Partial<Record<LanguageCode, string>> = { en: 'en', yo: 'yo', ig: 'ig', ha: 'ha' };

/**
 * Audio transcription via an OpenAI-compatible Whisper endpoint.
 */
export async function openaiTranscribeAudio(audioBase64: string, mimeType: string, opts: TranscribeOptions = {}): Promise<TranscribeResult> {
  const buffer = Buffer.from(audioBase64, 'base64');
  const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : mimeType.includes('webm') ? 'webm' : 'wav';

  return requestOpenAICompatible('transcribe', TRANSCRIPTIONS_PATHS, async (url, apiKey, signal) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), `audio.${extension}`);
    form.append('model', getTranscribeModel());
    form.append('response_format', 'verbose_json');
    const whisperLang = opts.languageHint ? WHISPER_LANGUAGE_MAP[opts.languageHint] : undefined;
    if (whisperLang) form.append('language', whisperLang);
    if (opts.prompt) form.append('prompt', opts.prompt);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form as unknown as BodyInit,
      signal,
    });

    const label = 'Audio transcription';
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, 'transcribe');

    const data = await assertGenuineJsonResponse(res, label, url);
    return { transcript: (data.text || '').trim(), detectedLanguageRaw: data.language };
  });
}

export interface SpeechResult {
  audioBase64: string;
  mimeType: string;
}

/**
 * Text-to-speech via an OpenAI-compatible /audio/speech endpoint. Note:
 * this endpoint takes no language parameter — it infers pronunciation from
 * the input text alone, and OpenAI's stock voices are tuned overwhelmingly
 * for English. See src/services/tts/speakAloud.ts for how this app routes
 * Hausa/Igbo/Yoruba to Sahara's native voices instead and only falls back
 * to this for English/Pidgin (or when Sahara isn't configured).
 */
export async function openaiSynthesizeSpeech(text: string, voice = 'alloy'): Promise<SpeechResult> {
  return requestOpenAICompatible('speech', SPEECH_PATHS, async (url, apiKey, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: getSpeechModel(), voice, input: text, response_format: 'mp3' }),
      signal,
    });

    const label = 'Speech synthesis';
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, 'speech');

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('html') || contentType.includes('json')) {
      throw new OriginMisconfiguredError(
        `${label}: the server is not an OpenAI-compatible API — it returned ${contentType || 'an unexpected response type'} instead of audio. Check OPENAI_BASE_URL in your deployment's environment settings.`
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    return { audioBase64: Buffer.from(arrayBuffer).toString('base64'), mimeType: 'audio/mpeg' };
  });
}

// A cheap, read-only reachability check for /api/providers/status — so
// "isConfigured" can mean "a key is present AND the configured origin is
// actually answering as an OpenAI-compatible API", not just "a string
// exists in the environment". Cached briefly so a status endpoint that's
// polled doesn't re-probe on every call.
let reachabilityCache: { reachable: boolean; message: string; checkedAt: number } | null = null;
const REACHABILITY_CACHE_TTL_MS = 30_000;

export async function checkOpenAIReachable(): Promise<{ reachable: boolean; message: string }> {
  if (!isOpenAIConfigured()) {
    return { reachable: false, message: 'Awaiting OPEN_AI_KEY in server secrets.' };
  }

  if (reachabilityCache && Date.now() - reachabilityCache.checkedAt < REACHABILITY_CACHE_TTL_MS) {
    return { reachable: reachabilityCache.reachable, message: reachabilityCache.message };
  }

  const origin = getOpenAIOrigin();
  const keys = getOpenAIKeys();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${keys[0]}` },
      signal: controller.signal,
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok && !isKeyLevelFailure(res.status)) {
      const message = `OpenAI origin (${origin}) responded with HTTP ${res.status}.`;
      reachabilityCache = { reachable: false, message, checkedAt: Date.now() };
      return { reachable: false, message };
    }
    if (!contentType.includes('application/json')) {
      const message = `OPENAI_BASE_URL (${origin}) is not an OpenAI-compatible API — it returned a non-JSON response. Check that variable in your deployment's environment settings.`;
      reachabilityCache = { reachable: false, message, checkedAt: Date.now() };
      return { reachable: false, message };
    }
    // A key-level failure (401/403/429) here still proves the origin itself
    // is a real, JSON-answering OpenAI-compatible API — the key, not the
    // origin, is the problem, and that's surfaced separately per-call via
    // KeyLevelError/quotaExceeded rather than here.
    const message = res.ok ? 'Reachable and answering JSON.' : `Reachable, but the configured key was rejected (HTTP ${res.status}).`;
    reachabilityCache = { reachable: true, message, checkedAt: Date.now() };
    return { reachable: true, message };
  } catch (err) {
    const message = isAbortError(err)
      ? `Timed out reaching the configured OpenAI origin (${origin}).`
      : err instanceof Error
        ? err.message
        : 'Could not reach the configured OpenAI origin.';
    reachabilityCache = { reachable: false, message, checkedAt: Date.now() };
    return { reachable: false, message };
  } finally {
    clearTimeout(timer);
  }
}

// Test-only: lets the test suite reset module-level caches between cases
// instead of leaking discovery/reachability state across unrelated tests.
export function __resetPathCacheForTests(): void {
  (Object.keys(resolvedPath) as EndpointCategory[]).forEach((k) => delete resolvedPath[k]);
  Object.values(ruledOutPaths).forEach((m) => m.clear());
  cacheFingerprint = null;
  reachabilityCache = null;
  modelListCache = null;
  (Object.keys(autoSelectedModel) as EndpointCategory[]).forEach((k) => (autoSelectedModel[k] = null));
}
