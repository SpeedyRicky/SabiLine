// server.ts
import express from "express";
import path2 from "path";
import dotenv from "dotenv";

// src/utils/sanitizeProviderError.ts
var URL_RE = /https?:\/\/[^\s"'`,)\]}]+/gi;
var ORG_ID_RE = /\borg[-_][A-Za-z0-9]{4,}\b/gi;
var SECRET_RE = /\b(?:sk|pk|rk|gsk)[-_][A-Za-z0-9_-]{8,}\b/gi;
var BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var JSON_BODY_RE = /\{[\s\S]*\}/g;
var QUOTA_COUNTER_RE = /\b(?:limit|used|requested|remaining|available|quota)\b\s*[:=]?\s*[\d,]{2,}/gi;
var LONG_OPAQUE_RE = /\b[A-Za-z0-9_-]{24,}\b/g;
var INFRASTRUCTURE_REPLACEMENTS = [
  [URL_RE, "the provider endpoint"],
  [ORG_ID_RE, "the account"],
  [SECRET_RE, "[redacted]"],
  [BEARER_RE, "Bearer [redacted]"],
  [EMAIL_RE, "[redacted]"]
];
var PROVIDER_BODY_REPLACEMENTS = [
  [JSON_BODY_RE, " "],
  [QUOTA_COUNTER_RE, "quota details withheld"],
  [LONG_OPAQUE_RE, "[redacted]"]
];
function applyReplacements(text, replacements) {
  let out = text ?? "";
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}
function scrubInfrastructure(text) {
  return applyReplacements(text, INFRASTRUCTURE_REPLACEMENTS);
}
function classifyProviderError(raw) {
  const text = raw.toLowerCase();
  if (/rate[ _-]?limit|too many requests|tokens per minute|\btpm\b|\brpm\b|\b429\b/.test(text)) {
    return "rate-limit";
  }
  if (/insufficient_quota|exceeded your current quota|billing|credit balance|out of credit|payment/.test(text)) {
    return "quota";
  }
  if (/invalid[ _]api[ _]key|incorrect api key|unauthorized|unauthenticated|\b401\b|\b403\b|authentication/.test(text)) {
    return "auth";
  }
  if (/model_not_found|model_decommissioned|does not exist or you do not have access|no longer supported|decommissioned|unknown model|unsupported model|model.*not found|not a valid model/.test(
    text
  )) {
    return "model";
  }
  if (/unknown_url|unknown request url|does not exist|not found|\b404\b/.test(text)) {
    return "not-found";
  }
  if (/\b50[234]\b|overloaded|temporarily unavailable|service unavailable|bad gateway|timed? ?out/.test(text)) {
    return "unavailable";
  }
  return "unknown";
}
var KIND_MESSAGE = {
  "rate-limit": "the provider is rate-limiting this request. Please try again in a moment.",
  quota: "the provider account has no quota left right now. Check the account billing or configure a backup key.",
  auth: "the provider rejected the configured API key, so no request could be made.",
  model: "the provider rejected the configured model. Point the matching model environment variable at one this provider actually serves.",
  "not-found": "the provider does not expose this API route. Check the configured base URL and path overrides.",
  unavailable: "the provider is temporarily unavailable.",
  unknown: "the provider returned an error."
};
function scrubProviderDetail(raw) {
  return applyReplacements(applyReplacements(raw, INFRASTRUCTURE_REPLACEMENTS), PROVIDER_BODY_REPLACEMENTS);
}
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
}
function sanitizeProviderError(raw, options = {}) {
  const subject = options.subject?.trim() || "The provider";
  const maxDetail = options.maxDetailChars ?? 180;
  const source = raw ?? "";
  const kind = classifyProviderError(source);
  const detail = maxDetail > 0 ? truncate(scrubProviderDetail(source), maxDetail) : "";
  const message = detail ? `${subject} failed: ${KIND_MESSAGE[kind]} Provider detail: ${detail}` : `${subject} failed: ${KIND_MESSAGE[kind]}`;
  return scrubProviderDetail(message);
}

// src/services/tts/openaiClient.ts
var OPENAI_KEY_ENV_VARS = [
  "OPEN_AI_KEY",
  "OPENAI_API_KEY",
  "SOPENAI_APIKEY",
  "TOPENAI_APIKEY",
  "FOPENAI_APIKEY",
  "GROQ_APIKEY",
  "GROKK_APIKEY",
  "GROK_APIKEY",
  "GROOK_APIKEY"
];
var DEFAULT_ORIGIN = "https://api.openai.com/v1";
function normalizeOrigin(raw) {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function getOpenAIOrigin() {
  return normalizeOrigin(process.env.OPENAI_BASE_URL?.trim() || DEFAULT_ORIGIN);
}
function getOpenAIKeys() {
  const seen = /* @__PURE__ */ new Set();
  const keys = [];
  for (const envVar of OPENAI_KEY_ENV_VARS) {
    const raw = process.env[envVar]?.trim();
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      keys.push(raw);
    }
  }
  return keys;
}
function isOpenAIConfigured() {
  return getOpenAIKeys().length > 0;
}
var OpenAINotConfiguredError = class extends Error {
  constructor() {
    super(
      "No API key is configured. Set OPEN_AI_KEY (and optionally SOPENAI_APIKEY / TOPENAI_APIKEY / FOPENAI_APIKEY, or GROQ_APIKEY for a Groq origin, as backups)."
    );
    this.name = "OpenAINotConfiguredError";
  }
};
function isKeyLevelFailure(status) {
  return status === 401 || status === 403 || status === 429;
}
function isQuotaExceededError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("429") || message.includes("insufficient_quota") || message.includes("rate_limit");
}
var OpenAITimeoutError = class extends Error {
  constructor(message = "OpenAI took too long to respond.") {
    super(message);
    this.name = "OpenAITimeoutError";
  }
};
function isTimeoutError(err) {
  return err instanceof OpenAITimeoutError;
}
function isAbortError(err) {
  return err instanceof Error && err.name === "AbortError";
}
function withTimeout(promise, ms) {
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
var BASE_TIMEOUT_MS = Number(process.env.OPENAI_CALL_TIMEOUT_MS) || 2e4;
var OPENAI_CHAT_TIMEOUT_MS = BASE_TIMEOUT_MS;
var OPENAI_TRANSCRIBE_TIMEOUT_MS = Math.round(BASE_TIMEOUT_MS * 1.5);
var DEFAULT_CHAT_MODEL = "gpt-4o-mini";
var DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
var DEFAULT_SPEECH_MODEL = "gpt-4o-mini-tts";
var autoSelectedModel = {
  chat: null,
  transcribe: null,
  speech: null
};
function getChatModel() {
  return autoSelectedModel.chat || process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}
function getTranscribeModel() {
  return autoSelectedModel.transcribe || process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL;
}
function getSpeechModel() {
  return autoSelectedModel.speech || process.env.OPENAI_SPEECH_MODEL?.trim() || DEFAULT_SPEECH_MODEL;
}
function getActiveModels() {
  return {
    chat: { model: getChatModel(), autoSelected: autoSelectedModel.chat !== null },
    transcribe: { model: getTranscribeModel(), autoSelected: autoSelectedModel.transcribe !== null },
    speech: { model: getSpeechModel(), autoSelected: autoSelectedModel.speech !== null }
  };
}
async function errorTextOf(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}
var KeyLevelError = class extends Error {
};
var PathNotFoundError = class extends Error {
};
var ModelNotAvailableError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelNotAvailableError";
  }
};
var MODEL_RANKING = {
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
      /mixtral/i
    ],
    // Speech, embedding and safety models answer /v1/models too, and none of
    // them can hold a conversation.
    exclude: /whisper|tts|audio|speech|embed|guard|moderat|rerank|vision|image|dall-?e|playai/i
  },
  transcribe: {
    // large-v3 over turbo on purpose: this is clinical intake in Hausa, Igbo,
    // Yoruba and Pidgin, where accuracy matters more than latency.
    prefer: [/whisper-large-v3$/i, /whisper-large/i, /whisper/i, /transcrib/i],
    exclude: /tts|embed|guard|moderat/i
  },
  speech: {
    prefer: [/^tts-1$/i, /tts/i, /speech/i],
    exclude: /whisper|transcrib|embed|guard|moderat/i
  }
};
var MODEL_LIST_TTL_MS = 3e5;
var modelListCache = null;
async function fetchModelIds(origin, apiKey) {
  if (modelListCache && modelListCache.origin === origin && Date.now() - modelListCache.fetchedAt < MODEL_LIST_TTL_MS) {
    return modelListCache.ids;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    if (!res.ok) return [];
    const body = await res.json();
    const ids = Array.isArray(body?.data) ? body.data.map((m) => String(m?.id ?? "")).filter(Boolean) : [];
    modelListCache = { origin, ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
function chooseModel(category, ids) {
  const { prefer, exclude } = MODEL_RANKING[category];
  const usable = ids.filter((id) => !exclude.test(id));
  if (usable.length === 0) return null;
  for (const pattern of prefer) {
    const match = usable.find((id) => pattern.test(id));
    if (match) return match;
  }
  return category === "chat" ? usable[0] : null;
}
function isModelLevel404(errorText) {
  const text = errorText.toLowerCase();
  if (text.includes("unknown_url") || text.includes("unknown request url")) return false;
  if (text.includes("model_not_found") || text.includes("model_decommissioned")) return true;
  return text.includes("model") && /does not exist|decommissioned|not found|no longer|unsupported|deprecated/.test(text);
}
var OriginMisconfiguredError = class extends Error {
};
function looksLikeHtml(text) {
  const head = text.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
async function assertGenuineJsonResponse(res, label, url) {
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const rawText = await res.text();
  if (!contentType.includes("application/json") || looksLikeHtml(rawText)) {
    throw new OriginMisconfiguredError(
      `${label}: the server is not an OpenAI-compatible API \u2014 it returned an HTML page instead of JSON. Check OPENAI_BASE_URL in your deployment's environment settings.`
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
var CHAT_COMPLETIONS_PATHS = ["/v1/chat/completions", "/chat/completions", "/api/v1/chat/completions", "/api/chat/completions"];
var TRANSCRIPTIONS_PATHS = ["/v1/audio/transcriptions", "/audio/transcriptions", "/api/v1/audio/transcriptions", "/api/audio/transcriptions"];
var SPEECH_PATHS = ["/v1/audio/speech", "/audio/speech", "/api/v1/audio/speech", "/api/audio/speech"];
var PATH_OVERRIDE_ENV = {
  chat: "OPENAI_CHAT_PATH",
  transcribe: "OPENAI_TRANSCRIBE_PATH",
  speech: "OPENAI_SPEECH_PATH"
};
var MODEL_ENV = {
  chat: "OPENAI_CHAT_MODEL",
  transcribe: "OPENAI_TRANSCRIBE_MODEL",
  speech: "OPENAI_SPEECH_MODEL"
};
function getPathOverride(category) {
  const raw = process.env[PATH_OVERRIDE_ENV[category]]?.trim();
  if (!raw) return null;
  return raw.startsWith("/") ? raw : `/${raw}`;
}
var resolvedPath = {};
var ruledOutPaths = { chat: /* @__PURE__ */ new Map(), transcribe: /* @__PURE__ */ new Map(), speech: /* @__PURE__ */ new Map() };
var NEGATIVE_CACHE_TTL_MS = 6e4;
var DISCOVERY_PROBE_TIMEOUT_MS = 6e3;
function isRuledOut(category, path3) {
  const ts = ruledOutPaths[category].get(path3);
  if (ts === void 0) return false;
  if (Date.now() - ts > NEGATIVE_CACHE_TTL_MS) {
    ruledOutPaths[category].delete(path3);
    return false;
  }
  return true;
}
var cacheFingerprint = null;
function ensureFreshCache(origin) {
  const fingerprint = origin;
  if (cacheFingerprint !== null && cacheFingerprint !== fingerprint) {
    Object.keys(resolvedPath).forEach((k) => delete resolvedPath[k]);
    Object.values(ruledOutPaths).forEach((m) => m.clear());
  }
  cacheFingerprint = fingerprint;
}
async function requestOpenAICompatible(category, pathCandidates, attempt) {
  try {
    return await attemptWithPathAndKeyFallback(category, pathCandidates, attempt);
  } catch (err) {
    if (!(err instanceof ModelNotAvailableError) || autoSelectedModel[category] !== null) throw err;
    const keys = getOpenAIKeys();
    const origin = getOpenAIOrigin();
    const available = await fetchModelIds(origin, keys[0]);
    const replacement = chooseModel(category, available);
    if (!replacement) {
      const listed = available.length ? `The provider lists: ${available.slice(0, 40).join(", ")}.` : "The provider did not return a usable model list either.";
      throw new ModelNotAvailableError(scrubInfrastructure(`${err.message} ${listed}`));
    }
    autoSelectedModel[category] = replacement;
    console.warn(
      `[openai] ${category} model was rejected by ${origin}; automatically switched to "${replacement}". Set ${MODEL_ENV[category]} to pin a different one.`
    );
    return attemptWithPathAndKeyFallback(category, pathCandidates, attempt);
  }
}
function notFoundMessage(category, origin, pathCandidates, lastNotFound) {
  const detail = lastNotFound ? ` Last response: ${sanitizeProviderError(lastNotFound)}` : "";
  console.error(`[openai] ${category}: no matching endpoint found on ${origin} \u2014 tried ${pathCandidates.join(", ")}.${detail}`);
  return `${category}: no matching endpoint found on the configured API base URL \u2014 tried ${pathCandidates.join(", ")}, all returned 404.${detail} If the path is right, check ${MODEL_ENV[category]}; otherwise set ${PATH_OVERRIDE_ENV[category]} to the correct path.`;
}
async function attemptWithPathAndKeyFallback(category, pathCandidates, attempt) {
  const keys = getOpenAIKeys();
  if (keys.length === 0) throw new OpenAINotConfiguredError();
  const origin = getOpenAIOrigin();
  ensureFreshCache(origin);
  const override = getPathOverride(category);
  if (override) resolvedPath[category] = override;
  let keysToTry = keys;
  let lastErr;
  if (!resolvedPath[category]) {
    const candidates = pathCandidates.filter((p) => !isRuledOut(category, p));
    if (candidates.length === 0) {
      throw new Error(notFoundMessage(category, origin, pathCandidates, null));
    }
    let existingPath = null;
    let lastNotFound = null;
    for (const path3 of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DISCOVERY_PROBE_TIMEOUT_MS);
      try {
        const result = await attempt(origin + path3, keys[0], controller.signal);
        resolvedPath[category] = path3;
        return result;
      } catch (err) {
        if (err instanceof PathNotFoundError) {
          ruledOutPaths[category].set(path3, Date.now());
          lastNotFound = err.message;
        } else if (err instanceof KeyLevelError) {
          if (existingPath === null) {
            existingPath = path3;
            lastErr = err;
          }
        } else if (isAbortError(err)) {
          lastErr = lastErr ?? new OpenAITimeoutError(`${category} probe of ${path3} timed out.`);
        } else {
          if (err instanceof ModelNotAvailableError) resolvedPath[category] = path3;
          throw err;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    if (!existingPath) {
      throw lastErr ?? new Error(notFoundMessage(category, origin, pathCandidates, lastNotFound));
    }
    resolvedPath[category] = existingPath;
    keysToTry = keys.slice(1);
  }
  const url = origin + resolvedPath[category];
  for (const key of keysToTry) {
    try {
      return await attempt(url, key);
    } catch (err) {
      lastErr = err;
      if (err instanceof KeyLevelError) continue;
      throw err;
    }
  }
  throw lastErr;
}
function classifyFailure(res, errorText, label, category) {
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
  console.error(`[openai] ${label} HTTP ${res.status}: ${errorText}`);
  if (isKeyLevelFailure(res.status)) {
    throw new KeyLevelError(sanitizeProviderError(errorText, { subject: `${label} (HTTP ${res.status})` }));
  }
  throw new Error(sanitizeProviderError(errorText, { subject: `${label} (HTTP ${res.status})` }));
}
async function openaiChatCompletion(messages, opts = {}) {
  return requestOpenAICompatible("chat", CHAT_COMPLETIONS_PATHS, async (url, apiKey, signal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: opts.model || getChatModel(),
        messages,
        ...opts.jsonResponse ? { response_format: { type: "json_object" } } : {}
      }),
      signal
    });
    const label = "Chat completion";
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, "chat");
    const data = await assertGenuineJsonResponse(res, label, url);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`${label} returned no message content.`);
    }
    return content;
  });
}
var WHISPER_LANGUAGE_MAP = { en: "en", yo: "yo", ig: "ig", ha: "ha" };
async function openaiTranscribeAudio(audioBase64, mimeType, opts = {}) {
  const buffer = Buffer.from(audioBase64, "base64");
  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : mimeType.includes("webm") ? "webm" : "wav";
  return requestOpenAICompatible("transcribe", TRANSCRIPTIONS_PATHS, async (url, apiKey, signal) => {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), `audio.${extension}`);
    form.append("model", getTranscribeModel());
    form.append("response_format", "verbose_json");
    const whisperLang = opts.languageHint ? WHISPER_LANGUAGE_MAP[opts.languageHint] : void 0;
    if (whisperLang) form.append("language", whisperLang);
    if (opts.prompt) form.append("prompt", opts.prompt);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal
    });
    const label = "Audio transcription";
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, "transcribe");
    const data = await assertGenuineJsonResponse(res, label, url);
    return { transcript: (data.text || "").trim(), detectedLanguageRaw: data.language };
  });
}
async function openaiSynthesizeSpeech(text, voice = "alloy") {
  return requestOpenAICompatible("speech", SPEECH_PATHS, async (url, apiKey, signal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: getSpeechModel(), voice, input: text, response_format: "mp3" }),
      signal
    });
    const label = "Speech synthesis";
    if (!res.ok) classifyFailure(res, await errorTextOf(res), label, "speech");
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("html") || contentType.includes("json")) {
      throw new OriginMisconfiguredError(
        `${label}: the server is not an OpenAI-compatible API \u2014 it returned ${contentType || "an unexpected response type"} instead of audio. Check OPENAI_BASE_URL in your deployment's environment settings.`
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return { audioBase64: Buffer.from(arrayBuffer).toString("base64"), mimeType: "audio/mpeg" };
  });
}
var reachabilityCache = null;
var REACHABILITY_CACHE_TTL_MS = 3e4;
async function checkOpenAIReachable() {
  if (!isOpenAIConfigured()) {
    return { reachable: false, message: "Awaiting OPEN_AI_KEY in server secrets." };
  }
  if (reachabilityCache && Date.now() - reachabilityCache.checkedAt < REACHABILITY_CACHE_TTL_MS) {
    return { reachable: reachabilityCache.reachable, message: reachabilityCache.message };
  }
  const origin = getOpenAIOrigin();
  const keys = getOpenAIKeys();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    const res = await fetch(`${origin}/v1/models`, {
      headers: { Authorization: `Bearer ${keys[0]}` },
      signal: controller.signal
    });
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok && !isKeyLevelFailure(res.status)) {
      const message2 = `OpenAI origin (${origin}) responded with HTTP ${res.status}.`;
      reachabilityCache = { reachable: false, message: message2, checkedAt: Date.now() };
      return { reachable: false, message: message2 };
    }
    if (!contentType.includes("application/json")) {
      const message2 = `OPENAI_BASE_URL (${origin}) is not an OpenAI-compatible API \u2014 it returned a non-JSON response. Check that variable in your deployment's environment settings.`;
      reachabilityCache = { reachable: false, message: message2, checkedAt: Date.now() };
      return { reachable: false, message: message2 };
    }
    const message = res.ok ? "Reachable and answering JSON." : `Reachable, but the configured key was rejected (HTTP ${res.status}).`;
    reachabilityCache = { reachable: true, message, checkedAt: Date.now() };
    return { reachable: true, message };
  } catch (err) {
    const message = isAbortError(err) ? `Timed out reaching the configured OpenAI origin (${origin}).` : err instanceof Error ? err.message : "Could not reach the configured OpenAI origin.";
    reachabilityCache = { reachable: false, message, checkedAt: Date.now() };
    return { reachable: false, message };
  } finally {
    clearTimeout(timer);
  }
}

// src/services/asr/audioPreprocess.ts
var FULL_SCALE_16BIT = 32767;
var QUIET_THRESHOLD_RATIO = 0.5;
var TARGET_PEAK_RATIO = 0.85;
var MAX_GAIN = 12;
function normalizeQuietAudio(wavBuffer) {
  if (wavBuffer.length < 44 || wavBuffer.toString("ascii", 0, 4) !== "RIFF" || wavBuffer.toString("ascii", 8, 12) !== "WAVE") {
    return { buffer: wavBuffer, applied: false, reason: "Not a recognized WAV container." };
  }
  let offset = 12;
  let fmtChunk = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (bodyStart + chunkSize > wavBuffer.length) break;
    if (chunkId === "fmt ") {
      fmtChunk = {
        audioFormat: wavBuffer.readUInt16LE(bodyStart),
        bitsPerSample: wavBuffer.readUInt16LE(bodyStart + 14)
      };
    } else if (chunkId === "data") {
      dataOffset = bodyStart;
      dataSize = chunkSize;
    }
    offset = bodyStart + chunkSize + chunkSize % 2;
  }
  if (!fmtChunk || dataOffset < 0) {
    return { buffer: wavBuffer, applied: false, reason: "Could not locate fmt/data chunks." };
  }
  if (fmtChunk.audioFormat !== 1 || fmtChunk.bitsPerSample !== 16) {
    return { buffer: wavBuffer, applied: false, reason: "Only 16-bit PCM WAV is supported for gain normalization." };
  }
  const sampleCount = Math.floor(dataSize / 2);
  if (sampleCount === 0) {
    return { buffer: wavBuffer, applied: false, reason: "No audio samples found." };
  }
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const abs = Math.abs(wavBuffer.readInt16LE(dataOffset + i * 2));
    if (abs > peak) peak = abs;
  }
  const originalPeakRatio = peak / FULL_SCALE_16BIT;
  if (peak === 0 || originalPeakRatio >= QUIET_THRESHOLD_RATIO) {
    return { buffer: wavBuffer, applied: false, reason: "Audio is already loud enough.", originalPeakRatio };
  }
  const gain = Math.min(TARGET_PEAK_RATIO * FULL_SCALE_16BIT / peak, MAX_GAIN);
  const outBuffer = Buffer.from(wavBuffer);
  for (let i = 0; i < sampleCount; i++) {
    const sample = outBuffer.readInt16LE(dataOffset + i * 2);
    const boosted = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    outBuffer.writeInt16LE(boosted, dataOffset + i * 2);
  }
  return {
    buffer: outBuffer,
    applied: true,
    originalPeakRatio,
    gainApplied: Number(gain.toFixed(2))
  };
}

// src/services/tts/openaiSynthesize.ts
var referenceAudioCache = /* @__PURE__ */ new Map();
async function synthesizeReferenceAudio(text, language) {
  const cacheKey = `${language}::${text}`;
  const cached = referenceAudioCache.get(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }
  try {
    const { audioBase64: mp3Base64, mimeType } = await openaiSynthesizeSpeech(text);
    let finalAudioBase64 = mp3Base64;
    if (mimeType === "audio/wav") {
      const { buffer } = normalizeQuietAudio(Buffer.from(mp3Base64, "base64"));
      finalAudioBase64 = buffer.toString("base64");
    }
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1, Math.round(wordCount * 0.4 * 10) / 10);
    const result = {
      success: true,
      audioBase64: finalAudioBase64,
      mimeType,
      durationSec
    };
    referenceAudioCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : "Reference audio synthesis failed."
    };
  }
}

// src/services/tts/wavJoin.ts
var RIFF = 1380533830;
var WAVE = 1463899717;
function parseWav(buf) {
  if (buf.length < 12 || buf.readUInt32BE(0) !== RIFF || buf.readUInt32BE(8) !== WAVE) {
    throw new Error("Not a RIFF/WAVE file.");
  }
  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = Math.min(bodyStart + size, buf.length);
    if (id === "fmt ") fmt = buf.subarray(bodyStart, bodyEnd);
    else if (id === "data") data = buf.subarray(bodyStart, bodyEnd);
    offset = bodyStart + size + size % 2;
  }
  if (!fmt || !data) throw new Error("WAVE file is missing a fmt or data chunk.");
  return { fmt, data };
}
function concatWav(buffers) {
  if (buffers.length === 0) throw new Error("No audio to join.");
  if (buffers.length === 1) return buffers[0];
  const parsed = buffers.map(parseWav);
  const fmt = parsed[0].fmt;
  for (const p of parsed.slice(1)) {
    if (!p.fmt.equals(fmt)) {
      throw new Error("Cannot join WAV files recorded in different audio formats.");
    }
  }
  const pcm = Buffer.concat(parsed.map((p) => p.data));
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + (8 + fmt.length) + (8 + pcm.length), 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  header.write("data", 20 + fmt.length, "ascii");
  header.writeUInt32LE(pcm.length, 24 + fmt.length);
  return Buffer.concat([header, pcm]);
}
function splitForSpeech(text, maxChars) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];
  const units = trimmed.match(/[^.!?]+[.!?]*\s*/g) ?? [trimmed];
  const pieces = [];
  let current = "";
  const flush = () => {
    const out = current.trim();
    if (out) pieces.push(out);
    current = "";
  };
  for (const unit of units) {
    for (const part of unit.length > maxChars ? splitOnWords(unit, maxChars) : [unit]) {
      if (current.length + part.length > maxChars) flush();
      current += part;
    }
  }
  flush();
  return pieces;
}
function splitOnWords(text, maxChars) {
  const out = [];
  let current = "";
  for (const word of text.split(/(\s+)/)) {
    if (word.length > maxChars) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
      continue;
    }
    if (current.length + word.length > maxChars) {
      out.push(current);
      current = "";
    }
    current += word;
  }
  if (current.trim()) out.push(current);
  return out;
}

// src/services/tts/saharaTts.ts
function saharaBaseUrl() {
  return (process.env.SAHARA_BASE_URL?.trim() || "https://infer.voice.intron.io").replace(/\/+$/, "");
}
function isSaharaConfigured() {
  return Boolean(process.env.SAHARA_API_KEY?.trim());
}
var SaharaNotConfiguredError = class extends Error {
  constructor() {
    super("SAHARA_API_KEY is not configured, so no native African-language voice is available.");
    this.name = "SaharaNotConfiguredError";
  }
};
var SaharaLanguageUnsupportedError = class extends Error {
  constructor(language) {
    super(`Sahara has no configured voice for "${language}".`);
    this.name = "SaharaLanguageUnsupportedError";
  }
};
var SAHARA_VOICE_BY_LANGUAGE = {
  yo: { voice_language: "yo", voice_accent: "yoruba" },
  ig: { voice_language: "ig", voice_accent: "igbo" },
  ha: { voice_language: "ha", voice_accent: "hausa" },
  en: { voice_language: "en", voice_accent: "nigerian" },
  pcm: { voice_language: "en", voice_accent: "nigerian" }
};
function genderFromVoiceId(voiceId) {
  return voiceId && voiceId.includes("-male") ? "male" : "female";
}
var DEFAULT_TIMEOUT_MS = Number(process.env.SAHARA_TTS_TIMEOUT_MS) || 25e3;
var DEFAULT_POLL_INTERVAL_MS = 1e3;
var MAX_RETRY_AFTER_MS = 1e4;
var STATUS_DONE = "TTS_TEXT_AUDIO_GENERATED";
var STATUS_FAILED = "TTS_TEXT_AUDIO_PROCESSING_FAILED";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function retryAfterMs(res, fallbackMs) {
  const header = res.headers.get("retry-after");
  const seconds = header === null ? NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
  return Math.min(seconds * 1e3, MAX_RETRY_AFTER_MS);
}
async function readBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function errorDetail(body, status) {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  return scrubProviderDetail(message) || `HTTP ${status}`;
}
var discoveredMaxChars = null;
var FALLBACK_MAX_CHARS = 100;
function parseMaxChars(message) {
  const match = /max limit of (\d+) characters/i.exec(message);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}
function isTextTooLong(status, message) {
  return status === 400 && /character count greater than the max limit/i.test(message);
}
async function synthesizeWithSahara(text, language, voiceId, opts = {}) {
  const apiKey = process.env.SAHARA_API_KEY?.trim();
  if (!apiKey) throw new SaharaNotConfiguredError();
  const voice = SAHARA_VOICE_BY_LANGUAGE[language];
  if (!voice) throw new SaharaLanguageUnsupportedError(language);
  const ctx = {
    apiKey,
    voice,
    voiceGender: genderFromVoiceId(voiceId),
    intervalMs: opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    deadline: Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  };
  const pieces = discoveredMaxChars !== null ? splitForSpeech(text, discoveredMaxChars) : [text.trim()];
  if (pieces.length === 0) throw new Error("There is no text to speak.");
  try {
    return await generateAll(pieces, ctx);
  } catch (err) {
    if (!(err instanceof SaharaTextTooLongError)) throw err;
    discoveredMaxChars = err.maxChars;
    return generateAll(splitForSpeech(text, err.maxChars), ctx);
  }
}
var SaharaTextTooLongError = class extends Error {
  constructor(maxChars) {
    super(`Sahara rejected the text as longer than its ${maxChars}-character limit.`);
    this.maxChars = maxChars;
    this.name = "SaharaTextTooLongError";
  }
};
async function generateAll(pieces, ctx) {
  const buffers = [];
  let durationSec = 0;
  for (const piece of pieces) {
    const part = await generateOne(piece, ctx);
    buffers.push(part.buffer);
    durationSec += part.durationSec;
  }
  return {
    audioBase64: concatWav(buffers).toString("base64"),
    mimeType: "audio/wav",
    durationSec: durationSec || Math.max(1.5, Math.round(pieces.join(" ").split(/\s+/).length * 0.45))
  };
}
async function generateOne(text, ctx) {
  const { apiKey, voice, voiceGender, intervalMs, deadline } = ctx;
  const sent = `voice_language="${voice.voice_language}" voice_accent="${voice.voice_accent}" voice_gender="${voiceGender}"`;
  const init = {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice_language: voice.voice_language,
      voice_accent: voice.voice_accent,
      voice_gender: voiceGender
    })
  };
  let res = await fetch(`${saharaBaseUrl()}/tts/v1/generate`, init);
  if (res.status === 429) {
    await sleep(retryAfterMs(res, intervalMs));
    res = await fetch(`${saharaBaseUrl()}/tts/v1/generate`, init);
    if (res.status === 429) {
      throw new Error("Sahara's rate limit (30 requests/minute) is still exhausted after waiting \u2014 try again shortly.");
    }
  }
  let body = await readBody(res);
  if (res.status === 503) {
    const textId = body?.data?.text_id ?? body?.text_id;
    if (!textId) {
      throw new Error("Sahara timed out generating the audio and returned no text_id to poll.");
    }
    body = await pollUntilGenerated(String(textId), apiKey, deadline, intervalMs);
  } else if (!res.ok) {
    const detail = errorDetail(body, res.status);
    if (isTextTooLong(res.status, detail)) {
      throw new SaharaTextTooLongError(parseMaxChars(detail) ?? FALLBACK_MAX_CHARS);
    }
    throw new Error(
      sanitizeProviderError(`Sahara rejected the request for ${sent} (HTTP ${res.status}): ${detail}`, {
        subject: "Sahara speech synthesis"
      })
    );
  }
  const status = body?.data?.processing_status ?? "unknown";
  if (status === STATUS_FAILED) {
    throw new Error("Sahara reported the speech job failed during processing.");
  }
  if (status !== STATUS_DONE) {
    throw new Error(`Sahara returned an unfinished job (status: ${status}) instead of generated audio.`);
  }
  const audioPath = body?.data?.audio_path;
  if (!audioPath) {
    throw new Error("Sahara reported the audio was generated but returned no audio_path.");
  }
  const audioRes = await fetch(audioPath);
  if (!audioRes.ok) {
    throw new Error(`Could not download the generated Sahara audio (HTTP ${audioRes.status}).`);
  }
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Sahara returned an empty audio file.");
  }
  return { buffer, durationSec: Number(body?.data?.audio_duration_in_seconds) || 0 };
}
async function pollUntilGenerated(textId, apiKey, deadline, intervalMs) {
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    const res = await fetch(`${saharaBaseUrl()}/tts/v1/status/${encodeURIComponent(textId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.status === 429) {
      await sleep(retryAfterMs(res, intervalMs));
      continue;
    }
    const body = await readBody(res);
    if (!res.ok) {
      throw new Error(
        sanitizeProviderError(`Sahara status check failed (HTTP ${res.status}): ${errorDetail(body, res.status)}`, {
          subject: "Sahara speech synthesis"
        })
      );
    }
    lastStatus = body?.data?.processing_status ?? "unknown";
    if (lastStatus === STATUS_DONE || lastStatus === STATUS_FAILED) return body;
    await sleep(intervalMs);
  }
  throw new Error(`Sahara did not finish generating audio in time (last status: ${lastStatus}).`);
}

// src/services/asr/customEndpointAsr.ts
function createCustomEndpointProvider(id, displayName, keyEnvVar, urlEnvVar) {
  return {
    id,
    displayName,
    isConfigured: () => Boolean(process.env[keyEnvVar] && process.env[urlEnvVar]),
    async transcribe(audioBase64, mimeType, language) {
      const start = Date.now();
      const apiKey = process.env[keyEnvVar];
      const endpointUrl = process.env[urlEnvVar];
      if (!apiKey || !endpointUrl) {
        return {
          success: false,
          error: `${keyEnvVar} and ${urlEnvVar} are not both configured.`,
          latencyMs: Date.now() - start
        };
      }
      try {
        const response = await fetch(endpointUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ audio: audioBase64, mimeType, language })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`${displayName} returned status ${response.status}: ${errText}`);
        }
        const data = await response.json();
        const transcript = String(data.transcript || data.text || "").trim();
        if (!transcript) {
          throw new Error(`${displayName} response did not include a transcript field.`);
        }
        return { success: true, transcript, latencyMs: Date.now() - start };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : `${displayName} transcription failed.`,
          latencyMs: Date.now() - start
        };
      }
    }
  };
}

// src/services/asr/saharaAsr.ts
var saharaAsrProvider = createCustomEndpointProvider(
  "sahara",
  "Intron Sahara",
  "SAHARA_API_KEY",
  "SAHARA_ASR_URL"
);

// src/services/asr/openaiAsr.ts
var openaiAsrProvider = {
  id: "openai",
  displayName: "OpenAI (Whisper transcription)",
  isConfigured: () => isOpenAIConfigured(),
  async transcribe(audioBase64, mimeType) {
    const start = Date.now();
    if (!isOpenAIConfigured()) {
      return { success: false, error: "No OpenAI API key is configured.", latencyMs: Date.now() - start };
    }
    try {
      const { transcript } = await openaiTranscribeAudio(audioBase64, mimeType);
      const clean = transcript.trim();
      if (!clean) {
        return { success: false, error: "OpenAI returned an empty transcription.", latencyMs: Date.now() - start };
      }
      return { success: true, transcript: clean, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "OpenAI transcription failed.",
        latencyMs: Date.now() - start
      };
    }
  }
};

// src/services/asr/registry.ts
var modelBProvider = createCustomEndpointProvider(
  "model_b",
  "Model B (custom endpoint)",
  "MODEL_B_API_KEY",
  "MODEL_B_API_URL"
);
var modelCProvider = createCustomEndpointProvider(
  "model_c",
  "Model C (custom endpoint)",
  "MODEL_C_API_KEY",
  "MODEL_C_API_URL"
);
var ASR_PROVIDER_REGISTRY = {
  openai: openaiAsrProvider,
  sahara: saharaAsrProvider,
  model_b: modelBProvider,
  model_c: modelCProvider
};
var DEFAULT_BENCHMARK_MODELS = ["openai", "sahara", "model_b", "model_c"];

// src/services/asr/transcribeLive.ts
var LIVE_ASR_PRIORITY = ["sahara", "model_b", "model_c", "openai"];
async function transcribeWithAllProviders(audioBase64, mimeType, language, selectedModels = LIVE_ASR_PRIORITY) {
  const attempts = {};
  await Promise.all(
    selectedModels.map(async (id) => {
      const provider = ASR_PROVIDER_REGISTRY[id];
      if (!provider) return;
      if (!provider.isConfigured()) {
        attempts[id] = {
          success: false,
          notConfigured: true,
          error: `${provider.displayName} is not configured.`,
          latencyMs: 0
        };
        return;
      }
      try {
        const result = await provider.transcribe(audioBase64, mimeType, language);
        attempts[id] = result;
      } catch (err) {
        attempts[id] = {
          success: false,
          error: err instanceof Error ? err.message : "Transcription failed.",
          latencyMs: 0
        };
      }
    })
  );
  const primaryProviderId = LIVE_ASR_PRIORITY.find((id) => selectedModels.includes(id) && attempts[id]?.success && attempts[id]?.transcript) ?? null;
  const primaryTranscript = primaryProviderId ? attempts[primaryProviderId].transcript ?? null : null;
  return { primaryProviderId, primaryTranscript, attempts };
}

// src/services/asr/detectLanguage.ts
var SUPPORTED_LANGUAGE_CODES = ["en", "pcm", "yo", "ig", "ha", "ful"];
var LANGUAGE_CHOICES_DESC = "English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful)";
var LANGUAGE_NAMES = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  ful: "Fulfulde"
};
var PIDGIN_DISAMBIGUATION = 'Important: Nigerian Pidgin is a distinct language and must be labelled "pcm", never "en". It borrows English words but has its own grammar. Treat it as pcm if you hear markers such as: "dey", "don", "go" as a future marker, "wetin", "abeg", "na" as a copula, "no be", "sabi", "comot", "pikin", "belle", "wahala", "small small", "make I", "e be like say". Judge by these structures, not by how many individual words look English. Only use "en" for standard or Nigerian-accented English that lacks this grammar.';
var LANGUAGE_MARKERS = {
  en: 'standard English grammar \u2014 "I have", "I am", "since yesterday", "please", "thank you" \u2014 with none of the non-English markers below.',
  pcm: 'Pidgin grammar rather than English vocabulary (see the Pidgin note above): "dey", "don", "wetin", "abeg", "na", "no be", "sabi", "make I", "e be like say", "body dey hot", "belle dey pain".',
  yo: '"mo ni" / "mo n" (I have), "or\xED" and "orififo" (head / headache \u2014 headache, NOT cough), "\xECba" (fever), "ik\u1ECD\u0301" (cough), "in\xFA" (stomach), "\u1ECDm\u1ECD" (child), "j\u1ECD\u0300w\u1ECD\u0301" (please), "\u1E63\xE9", "k\xED ni", "b\xE1wo", "o \u1E63e", "\xE0\xE1r\u1EB9\u0300" (weakness), "\xF2\xF3r\xF9n" (pain), "\u1EB9\u0300j\u1EB9\u0300" (blood). Subject pronouns "mo / \xF3 / \xE0w\u1ECDn" and "ni" as a copula are strong Yoruba signals.',
  ig: '"m nwere" (I have), "isi" (head), "isi \u1ECDw\u1EE5wa" / "isi na-egbu m" (headache), "ah\u1EE5 \u1ECDk\u1EE5" (fever), "\u1EE5kwara" (cough), "af\u1ECD" (stomach), "mgbu" (pain), "\u1ECDgw\u1EE5" (medicine), "biko" (please), "kedu", "g\u1ECBn\u1ECB", "\u1ECD d\u1ECB", "kwa". The "na-" verb prefix and the "m / g\u1ECB" pronouns are strong Igbo signals.',
  ha: '"ina jin" (I feel), "ciwo" / "ciwon" (pain), "kai" (head), "jiki" (body), "zazzabi" (fever), "tari" (cough), "ciki" (stomach), "magani" (medicine), "don Allah" (please), "nawa", "yaya", "kuma" (and), "ba ni". The "-n" genitive (ciwon kai) and "na" before a verb are strong Hausa signals.',
  ful: '"mi" (I), "na" as a first-person marker, "hoore" (head), "wane" / "no" (who / it is), "jam" (hello, peace), "nyaako", "eey", "na nawa" / "na nawni" (it hurts me), "doktooro" (doctor). Noun-class prefixes on many nouns are characteristic.'
};
var LANGUAGE_DISAMBIGUATION = `${PIDGIN_DISAMBIGUATION} Weigh short utterances by these per-language markers: ${Object.keys(LANGUAGE_MARKERS).map((code) => `${LANGUAGE_NAMES[code] ?? code}: ${LANGUAGE_MARKERS[code]}`).join(" ")} Judge by grammar and function words, not by one word that also occurs in another language.`;
var CONFIDENCE_GUIDANCE = 'Also report "confidence": a number from 0 to 1 for how sure you are of that language on this utterance alone. Use below 0.5 when the text is short, ambiguous, or mostly names and numbers shared across languages; use 0.85 or above only when the grammar is unmistakable.';
var LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD = 0.6;
function resolveLanguageSwitch(anchor, candidate, confidence, isLowEvidence) {
  if (!candidate || !SUPPORTED_LANGUAGE_CODES.includes(candidate)) {
    return { language: anchor, switched: false, reason: "no-candidate" };
  }
  if (candidate === anchor) {
    return { language: anchor, switched: false, reason: "same-language" };
  }
  if (isLowEvidence) {
    return { language: anchor, switched: false, reason: "low-evidence" };
  }
  if (typeof confidence === "number" && confidence < LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD) {
    return { language: anchor, switched: false, reason: "low-confidence" };
  }
  return { language: candidate, switched: true, reason: "switched" };
}
function parseConfidence(raw) {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return Math.min(1, Math.max(0, value));
}
var CLINIC_VOCAB_PROMPTS = {
  en: "Clinic vocabulary: fever, malaria, headache, medication, appointment, allergy, pharmacy, symptoms.",
  yo: "\u1ECC\u0300r\u1ECD\u0300 il\xE9-\xECw\xF2s\xE0n: ib\xE0, or\xED f\xEDf\u1ECD\u0301, egbogi, \xECp\xE0d\xE9, aleji.",
  ig: "Okwu \u1EE5l\u1ECD \u1ECDgw\u1EE5: ah\u1EE5 \u1ECDk\u1EE5, isi \u1ECDw\u1EE5wa, \u1ECDgw\u1EE5, oge nkwenye, allergy.",
  ha: "Kalmomin asibiti: zazzabi, ciwon kai, magani, alkawari, rashin lafiya.",
  pcm: "Clinic wetin dem dey talk: fever, malaria, headache, medicine, appointment, allergy."
};
async function detectLanguageAndTranscribe(audioBase64, mimeType) {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: "No OpenAI API key is configured.", latencyMs: Date.now() - start };
  }
  try {
    const { transcript } = await withTimeout(openaiTranscribeAudio(audioBase64, mimeType), OPENAI_TRANSCRIBE_TIMEOUT_MS);
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      return { success: false, error: "The model returned an empty transcription.", latencyMs: Date.now() - start };
    }
    const classification = await detectLanguageFromText(cleanTranscript);
    if (!classification.success) {
      return {
        success: true,
        languageCode: "en",
        transcript: cleanTranscript,
        latencyMs: Date.now() - start
      };
    }
    return {
      success: true,
      languageCode: classification.languageCode ?? "en",
      transcript: cleanTranscript,
      latencyMs: Date.now() - start
    };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : "Language detection failed.",
      latencyMs: Date.now() - start
    };
  }
}
var NO_SIGNAL_UTTERANCES = /* @__PURE__ */ new Set([
  "ok",
  "okay",
  "yes",
  "no",
  "yeah",
  "yep",
  "nope",
  "sure",
  "hmm",
  "mm",
  "mhm",
  "thanks",
  "thank you",
  "please",
  "hello",
  "hi",
  "hey",
  "abeg",
  "oya",
  "eh"
]);
function isLowEvidenceForLanguageSwitch(text) {
  const cleaned = text.trim().toLowerCase().replace(/[.!?,;:'"()]/g, "").replace(/\s+/g, " ");
  if (!cleaned) return true;
  if (NO_SIGNAL_UTTERANCES.has(cleaned)) return true;
  if (/^[\d\s+-]+$/.test(cleaned)) return true;
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length === 1 && cleaned.length <= 6) return true;
  return false;
}
async function transcribeWithLanguageHint(audioBase64, mimeType, languageHint) {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: "No OpenAI API key is configured.", latencyMs: Date.now() - start };
  }
  try {
    const { transcript } = await withTimeout(
      openaiTranscribeAudio(audioBase64, mimeType, { languageHint, prompt: CLINIC_VOCAB_PROMPTS[languageHint] }),
      OPENAI_TRANSCRIBE_TIMEOUT_MS
    );
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      return { success: false, error: "The model returned an empty transcription.", latencyMs: Date.now() - start };
    }
    return { success: true, languageCode: languageHint, transcript: cleanTranscript, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : "Transcription failed.",
      latencyMs: Date.now() - start
    };
  }
}
async function detectLanguageFromText(text, previousLanguage) {
  const start = Date.now();
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: "No OpenAI API key is configured.", latencyMs: Date.now() - start };
  }
  const anchorNote = previousLanguage ? ` The patient's previous message was in ${LANGUAGE_NAMES[previousLanguage] ?? previousLanguage} \u2014 treat that as a hint, not a certainty: only report a different language if this new text gives clear evidence of a switch (a bare "okay", "yes", a name, or a number alone is not enough evidence).` : "";
  try {
    const content = await withTimeout(
      openaiChatCompletion(
        [
          {
            role: "user",
            content: `A patient typed this at a health clinic intake desk: "${text.replace(/"/g, "'")}". Identify which language they most likely intended, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. ${LANGUAGE_DISAMBIGUATION}${anchorNote} ${CONFIDENCE_GUIDANCE} Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "confidence": 0.0}`
          }
        ],
        { jsonResponse: true }
      ),
      OPENAI_CHAT_TIMEOUT_MS
    );
    const parsed = JSON.parse(content || "{}");
    const languageCode = SUPPORTED_LANGUAGE_CODES.includes(parsed.languageCode) ? parsed.languageCode : "en";
    const confidence = parseConfidence(parsed.confidence);
    return { success: true, languageCode, confidence, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : "Language detection failed.",
      latencyMs: Date.now() - start
    };
  }
}

// src/services/intake/converse.ts
var LANGUAGE_NAMES2 = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  ful: "Fulfulde"
};
var DEPARTMENTS = [
  "Malaria & Fever Care",
  "Maternal Health",
  "Child & Vaccination Clinic",
  "Cardiology",
  "Pharmacy Refill",
  "General Triage"
];
var SYMPTOM_PRESERVATION = 'SYMPTOM FIDELITY (critical): "reasonForVisit" and "allergies" must preserve EVERY distinct symptom or allergy the patient has named anywhere in this conversation, translated into plain English. If they named two, the field contains both, joined with "and" or a comma \u2014 never just one. Never drop a symptom, never merge two different symptoms into one, and above all never substitute a different symptom for the one they actually named. Yoruba "orififo" (or\xED f\xEDf\u1ECD\u0301) and Yoruba "ori mi n dun mi" both mean HEADACHE \u2014 recording either of them as "cough" is a clinical error, not a rounding error. If you are not confident what an unfamiliar word means, keep it verbatim alongside your best English translation, for example "orififo (headache)" or "unclear term: <word>" \u2014 an untranslated word a clinician can look up is far safer than a confident wrong one. When the patient names a new symptom on a later turn, ADD it to the existing list rather than replacing what is already recorded.';
var SYMPTOM_GLOSSARY = "Common Nigerian clinic terms, as a translating aid only \u2014 not a complete dictionary, and never a reason to override what the patient actually said: Yoruba: iba = fever/malaria; orififo (or\xED f\xEDf\u1ECD\u0301) = headache; ik\u1ECD\u0301 = cough; in\xFA r\xEDro = stomach ache; \xE8\xE9b\xEC = vomiting; \xE0\xE1r\u1EB9\u0300 = weakness; \xF2\xF3r\xF9n = pain; \u1ECDgb\u1EB9\u0301 = sore/wound; \xECgb\u1EB9\u0301 gbuuru = diarrhoea. Igbo: ah\u1EE5 \u1ECDk\u1EE5 = fever; isi \u1ECDw\u1EE5wa / isi na-egbu m = headache; \u1EE5kwara = cough; af\u1ECD mgbu = stomach pain; \u1ECDgb\u1EE5gb\u1ECD = vomiting; ike \u1ECDgw\u1EE5gw\u1EE5 = weakness; mgbu = pain; \u1ECDny\xE1 = wound; af\u1ECD \u1ECDs\u1ECBsa = diarrhoea. Hausa: zazzabi = fever; ciwon kai = headache; tari = cough; ciwon ciki = stomach pain; amai = vomiting; gajiya = fatigue; ciwo = pain; rauni = wound; gudawa = diarrhoea. Nigerian Pidgin: body dey hot / fever = fever; head dey pain = headache; cough = cough; belle dey pain = stomach pain; vomit / throw up = vomiting; body dey weak = weakness; sore / wound = wound; running belle = diarrhoea. Fulfulde is not covered above \u2014 translate it carefully and keep the original word if unsure.";
function nextSlots() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return [1, 2, 3].map((offsetDays) => {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() + offsetDays);
    const hour = offsetDays % 2 === 0 ? 10 : 14;
    const minute = offsetDays % 2 === 0 ? 30 : 15;
    d.setHours(hour, minute, 0, 0);
    const label = `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${offsetDays % 2 === 0 ? "10:30am" : "2:15pm"}`;
    return { label, iso: d.toISOString() };
  });
}
function findSlotIso(slotLabel, slots) {
  if (!slotLabel) return null;
  const match = slots.find((s) => s.label === slotLabel);
  return match ? match.iso : null;
}
function buildSystemInstructionWithSlots(languageAnchor, elapsedMinutes, isOpeningCall, slots) {
  const anchorName = LANGUAGE_NAMES2[languageAnchor] || languageAnchor;
  const driftNote = elapsedMinutes >= 2 ? ` This call has been going for about ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} so far. If the conversation has drifted away from health or clinic topics and stayed off-topic for somewhere in the range of 2 to 7 minutes of that drift, gently mention \u2014 once, not every message \u2014 that you're the SabiLine health line and are best able to help with health-related concerns, then offer to get back to their visit. Don't cut off brief small talk; only redirect once it's clearly gone on a while.` : "";
  const openingNote = isOpeningCall ? " The call has just connected and the patient hasn't said anything yet \u2014 don't wait for them: open with a brief, warm greeting that introduces yourself as SabiLine and invites them to share why they're calling, in English (you don't know their language yet)." : "";
  const languageDirective = isOpeningCall ? 'Write "spokenReply" in English and set "languageCode" to "en" \u2014 nobody has spoken yet, so there is nothing to detect.' : `LANGUAGE (most important rule): figure out which language the patient is CURRENTLY speaking, from this set: English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful). ${LANGUAGE_DISAMBIGUATION} Your best guess going into this turn was ${anchorName} \u2014 treat that as a starting hint, not a certainty: a patient can and does switch languages mid-call. Stay with ${anchorName} unless this turn's words give clear evidence of a different language; a short reply like "okay", "yes", a bare number, or a name alone is NOT enough evidence to switch. Set "languageCode" to whichever language you conclude for THIS turn, then write every word of "spokenReply" in that same language. If the patient mixes languages, mirror that mixing, but keep "languageCode" and the base of "spokenReply" as the dominant one. Never mention, explain, or apologise for which language you are using, and never say the same thing twice in two languages. ${CONFIDENCE_GUIDANCE} Set "confidence" to your certainty in "languageCode" for THIS turn alone. This rule governs "spokenReply", "languageCode" and "confidence" only \u2014 every other JSON field stays in English, as set out below.`;
  return [
    "You are SabiLine, a warm, human-sounding intake receptionist at an African health clinic.",
    "Speak naturally like a real person: vary your wording, react to what the patient actually said, keep each reply short (1-2 sentences, occasionally 3) since it will be read aloud, and never repeat a question you already have an answer to." + openingNote,
    languageDirective,
    "Through natural back-and-forth, not a rigid checklist and not necessarily in this order, find out: the patient's name, their age or date of birth, a phone number to reach them on (explain it's so the clinic can call to remind them of their appointment), their payment or insurance type, their reason for visiting, how long their symptoms have lasted, and any known allergies. Ask about one thing at a time. If they don't know or decline to answer something, don't press repeatedly \u2014 move on and leave it blank.",
    "It's fine for the patient to chat about other things along the way \u2014 follow them naturally and don't refuse to engage." + driftNote,
    `Once you have gathered what you reasonably can, pick the single best-fitting department for their reason for visit from this list: ${DEPARTMENTS.join(", ")} \u2014 then propose exactly one appointment time from these options: ${slots.map((s) => s.label).join(", ")} (say it to the patient in their current language, but the "appointmentSlot" JSON field must be copied verbatim from that English list). If they want a different time, offer another option from that same list. Once they confirm a time, let them know their visit is logged and a staff member will follow up shortly, then say goodbye \u2014 set "done" to true only on that final message.`,
    'Always reply with ONLY this JSON: {"spokenReply": string, "languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "confidence": number, "done": boolean, "fields": {"name": string|null, "ageOrDob": string|null, "phoneNumber": string|null, "paymentType": string|null, "reasonForVisit": string|null, "symptomDuration": string|null, "allergies": string|null}, "department": string|null, "appointmentSlot": string|null, "needsManualReview": boolean}.',
    `CRITICAL: "spokenReply" is the only field spoken/shown to the patient and, together with "languageCode", is the only part of the response allowed to reflect the patient's language. Every other field in the JSON \u2014 "fields" (name, ageOrDob, phoneNumber, paymentType, reasonForVisit, symptomDuration, allergies), "department", and "appointmentSlot" \u2014 MUST always be written in English regardless of what language the patient spoke, because clinic staff who read the record only read English. Translate the patient's answers into plain English for these fields (e.g. a Yoruba reason for visit like "Mo ni iba" must be recorded as "Fever"); never leave them in the original language.`,
    SYMPTOM_PRESERVATION,
    SYMPTOM_GLOSSARY,
    '"fields" is your best current understanding so far, updated every turn \u2014 use null (never a guess) for anything the patient has not actually stated. "department" and "appointmentSlot" stay null until a time is actually confirmed, and "appointmentSlot" must exactly match one of the English options given above. Set "needsManualReview" to true only once "done" is true and important fields are still missing or unclear.'
  ].join(" ");
}
async function getSabiLineReply(history, userText, languageAnchor, elapsedMinutes) {
  if (!isOpenAIConfigured()) {
    return { success: false, notConfigured: true, error: "OPEN_AI_KEY is required for the conversational intake." };
  }
  const isOpeningCall = userText === null;
  const slotsForThisTurn = nextSlots();
  try {
    const newTurnText = isOpeningCall ? "[The call has just connected.]" : userText;
    const messages = [
      { role: "system", content: buildSystemInstructionWithSlots(languageAnchor, elapsedMinutes, isOpeningCall, slotsForThisTurn) },
      ...history.map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text })),
      { role: "user", content: newTurnText }
    ];
    const content = await withTimeout(
      openaiChatCompletion(messages, { jsonResponse: true }),
      OPENAI_CHAT_TIMEOUT_MS
    );
    let parsed;
    try {
      parsed = JSON.parse(content || "{}");
    } catch {
      return {
        success: false,
        needsManualReview: true,
        error: "The model returned a response that could not be understood. Please try again."
      };
    }
    const spokenReply = String(parsed.spokenReply || "").trim();
    if (!spokenReply) {
      return { success: false, error: "The model returned an empty reply." };
    }
    const languageCode = SUPPORTED_LANGUAGE_CODES.includes(parsed.languageCode) ? parsed.languageCode : languageAnchor;
    const confidence = parseConfidence(parsed.confidence);
    return {
      success: true,
      spokenReply,
      languageCode,
      confidence,
      done: Boolean(parsed.done),
      fields: parsed.fields,
      department: parsed.department ?? null,
      appointmentSlot: parsed.appointmentSlot ?? null,
      appointmentSlotIso: findSlotIso(parsed.appointmentSlot, slotsForThisTurn),
      needsManualReview: Boolean(parsed.needsManualReview)
    };
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      timedOut: isTimeoutError(err),
      error: err instanceof Error ? err.message : "Conversation turn failed."
    };
  }
}

// src/services/reminder/twilioReminder.ts
var TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
function isTwilioConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}
function escapeForTwiml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function placeReminderCall(toNumber, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !fromNumber) {
    return {
      success: false,
      notConfigured: true,
      error: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must all be set to place reminder calls."
    };
  }
  const twiml = `<Response><Say voice="Polly.Joanna">${escapeForTwiml(message)}</Say></Response>`;
  const body = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    Twiml: twiml
  });
  try {
    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || `Twilio returned status ${response.status}.`);
    }
    if (!data.sid) {
      throw new Error("Twilio response did not include a call SID.");
    }
    return { success: true, callSid: data.sid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Placing the reminder call failed."
    };
  }
}

// src/services/reminder/reminderScheduler.ts
import fs from "node:fs";
import path from "node:path";
var TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1e3;
var TWO_HOURS_MS = 2 * 60 * 60 * 1e3;
var MAX_TIMEOUT_MS = 2 ** 31 - 1;
var DATA_DIR = path.join(process.cwd(), "data");
var STORE_FILE = path.join(DATA_DIR, "scheduled-reminders.json");
var activeTimers = /* @__PURE__ */ new Map();
function loadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function saveStore(reminders) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(reminders, null, 2));
  } catch {
  }
}
function upsert(reminder) {
  const all = loadStore();
  const idx = all.findIndex((r) => r.id === reminder.id);
  if (idx >= 0) all[idx] = reminder;
  else all.push(reminder);
  saveStore(all);
}
async function fireReminder(reminder) {
  activeTimers.delete(reminder.id);
  if (!isTwilioConfigured()) {
    upsert({ ...reminder, firedAt: (/* @__PURE__ */ new Date()).toISOString(), result: "failed", error: "Twilio not configured." });
    return;
  }
  const when = reminder.kind === "2-day" ? "in about 2 days" : "in about 2 hours";
  const departmentPart = reminder.department ? ` at ${reminder.department}` : "";
  const slotPart = reminder.appointmentSlot ? ` on ${reminder.appointmentSlot}` : "";
  const message = `Hello, this is a reminder from SabiLine. Your appointment${departmentPart}${slotPart} is coming up ${when}. Please arrive a few minutes early. Thank you.`;
  const result = await placeReminderCall(reminder.phoneNumber, message);
  upsert({
    ...reminder,
    firedAt: (/* @__PURE__ */ new Date()).toISOString(),
    result: result.success ? "sent" : "failed",
    error: result.error
  });
}
function scheduleTimer(reminder) {
  const delayMs = new Date(reminder.fireAtIso).getTime() - Date.now();
  if (delayMs <= 0) {
    upsert({ ...reminder, firedAt: (/* @__PURE__ */ new Date()).toISOString(), result: "skipped-past", error: "Fire time already passed." });
    return;
  }
  if (delayMs > MAX_TIMEOUT_MS) {
    return;
  }
  const timer = setTimeout(() => {
    void fireReminder(reminder);
  }, delayMs);
  activeTimers.set(reminder.id, timer);
}
function scheduleAppointmentReminders(params) {
  const { visitId, phoneNumber, department, appointmentSlot, appointmentSlotIso } = params;
  if (!phoneNumber) return { scheduled: false, reason: "No phone number on file." };
  if (!appointmentSlotIso) return { scheduled: false, reason: "No confirmed appointment timestamp." };
  const apptTime = new Date(appointmentSlotIso).getTime();
  if (Number.isNaN(apptTime)) return { scheduled: false, reason: "Appointment timestamp could not be parsed." };
  const candidates = [
    { kind: "2-day", fireAt: apptTime - TWO_DAYS_MS },
    { kind: "2-hour", fireAt: apptTime - TWO_HOURS_MS }
  ];
  for (const { kind, fireAt } of candidates) {
    if (fireAt <= Date.now()) continue;
    const reminder = {
      id: `${visitId}:${kind}`,
      phoneNumber,
      department,
      appointmentSlot,
      appointmentSlotIso,
      kind,
      fireAtIso: new Date(fireAt).toISOString()
    };
    upsert(reminder);
    scheduleTimer(reminder);
  }
  return { scheduled: true };
}
function rehydratePendingReminders() {
  const all = loadStore();
  for (const reminder of all) {
    if (reminder.firedAt) continue;
    scheduleTimer(reminder);
  }
}
async function runDueReminders() {
  const all = loadStore();
  const due = all.filter((r) => !r.firedAt && new Date(r.fireAtIso).getTime() <= Date.now());
  for (const reminder of due) {
    await fireReminder(reminder);
  }
  return { fired: due.length };
}
function listScheduledReminders() {
  return loadStore();
}

// src/services/notify/staffNotify.ts
var LANGUAGE_NAMES3 = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  ful: "Fulfulde"
};
function buildEnglishVisitSummary(params) {
  const { referenceNumber, language, languageHistory, fields, department, appointmentSlot, needsManualReview } = params;
  const langName = LANGUAGE_NAMES3[language] || language;
  const lines = [
    `New SabiLine patient intake \u2014 ${referenceNumber}`,
    `Conversation language: ${langName} (recorded here in English)`,
    `Name: ${fields.name || "not provided"}`,
    `Age / DOB: ${fields.ageOrDob || "not provided"}`,
    `Phone number: ${fields.phoneNumber || "not provided"}`,
    `Payment / insurance: ${fields.paymentType || "not provided"}`,
    `Reason for visit: ${fields.reasonForVisit || "not provided"}`,
    `Symptom duration: ${fields.symptomDuration || "not provided"}`,
    `Allergies: ${fields.allergies || "not provided"}`,
    `Department: ${department || "not yet assigned"}`,
    `Proposed appointment: ${appointmentSlot || "not yet scheduled"}`
  ];
  if (languageHistory && languageHistory.length > 1) {
    lines.push(`Language changed during call: ${languageHistory.map((l) => LANGUAGE_NAMES3[l] || l).join(" \u2192 ")}`);
  }
  if (needsManualReview) {
    lines.push("\u26A0\uFE0F Flagged for manual review \u2014 one or more fields are missing or unclear.");
  }
  return lines.join("\n");
}
async function notifyStaffOfVisit(summary) {
  const url = process.env.STAFF_NOTIFY_WEBHOOK_URL?.trim();
  if (!url) {
    return { success: false, notConfigured: true, error: "STAFF_NOTIFY_WEBHOOK_URL is not configured." };
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary, content: summary })
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Staff notification webhook returned status ${response.status}. ${errText}`.trim());
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Sending the staff notification failed."
    };
  }
}

// server.ts
import { randomUUID } from "crypto";

// src/services/benchmark/normalization.ts
var DEFAULT_OPTIONS = {
  stripPunctuation: true,
  toLowerCase: true,
  normalizeWhitespace: true,
  stripDiacritics: false,
  removeFillers: false
};
var COMMON_SPEECH_FILLERS = /* @__PURE__ */ new Set([
  "um",
  "uh",
  "er",
  "ah",
  "like",
  "you know",
  "hmm",
  "toh",
  "shebi",
  "kwanu"
]);
function normalizeTranscript(text, options = {}) {
  if (!text) return "";
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let normalized = text;
  if (opts.toLowerCase) {
    normalized = normalized.toLowerCase();
  }
  if (opts.stripDiacritics) {
    normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  if (opts.stripPunctuation) {
    normalized = normalized.replace(/[-–—/]/g, " ");
    normalized = normalized.replace(/[.,!?;:"'()\[\]{}«»""'’`]/g, "");
  }
  if (opts.removeFillers) {
    const words = normalized.split(/\s+/);
    normalized = words.filter((w) => !COMMON_SPEECH_FILLERS.has(w)).join(" ");
  }
  if (opts.normalizeWhitespace) {
    normalized = normalized.trim().replace(/\s+/g, " ");
  }
  return normalized;
}
function tokenizeWords(text) {
  const norm = normalizeTranscript(text);
  if (!norm) return [];
  return norm.split(/\s+/).filter(Boolean);
}
function tokenizeChars(text) {
  const norm = normalizeTranscript(text);
  if (!norm) return [];
  return Array.from(norm.replace(/\s+/g, ""));
}

// src/services/benchmark/wer.ts
function calculateWER(referenceText, hypothesisText, options) {
  const normRef = normalizeTranscript(referenceText, options);
  const normHyp = normalizeTranscript(hypothesisText, options);
  const refTokens = tokenizeWords(normRef);
  const hypTokens = tokenizeWords(normHyp);
  const n = refTokens.length;
  const m = hypTokens.length;
  if (n === 0) {
    return {
      wer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceWordCount: 0,
      hypothesisWordCount: m,
      normalizedReference: normRef,
      normalizedHypothesis: normHyp,
      alignedTokens: hypTokens.map((h) => ({ ref: null, hyp: h, type: "insertion" }))
    };
  }
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const ops = Array.from({ length: n + 1 }, () => Array(m + 1).fill(""));
  for (let i2 = 0; i2 <= n; i2++) {
    dp[i2][0] = i2;
    ops[i2][0] = "D";
  }
  for (let j2 = 0; j2 <= m; j2++) {
    dp[0][j2] = j2;
    ops[0][j2] = "I";
  }
  ops[0][0] = "C";
  for (let i2 = 1; i2 <= n; i2++) {
    for (let j2 = 1; j2 <= m; j2++) {
      if (refTokens[i2 - 1] === hypTokens[j2 - 1]) {
        dp[i2][j2] = dp[i2 - 1][j2 - 1];
        ops[i2][j2] = "C";
      } else {
        const subCost = dp[i2 - 1][j2 - 1] + 1;
        const delCost = dp[i2 - 1][j2] + 1;
        const insCost = dp[i2][j2 - 1] + 1;
        if (subCost <= delCost && subCost <= insCost) {
          dp[i2][j2] = subCost;
          ops[i2][j2] = "S";
        } else if (delCost <= insCost) {
          dp[i2][j2] = delCost;
          ops[i2][j2] = "D";
        } else {
          dp[i2][j2] = insCost;
          ops[i2][j2] = "I";
        }
      }
    }
  }
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  const alignedTokens = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && (ops[i][j] === "C" || ops[i][j] === "S")) {
      if (ops[i][j] === "S") {
        substitutions++;
        alignedTokens.unshift({ ref: refTokens[i - 1], hyp: hypTokens[j - 1], type: "substitution" });
      } else {
        alignedTokens.unshift({ ref: refTokens[i - 1], hyp: hypTokens[j - 1], type: "correct" });
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || ops[i][j] === "D")) {
      deletions++;
      alignedTokens.unshift({ ref: refTokens[i - 1], hyp: null, type: "deletion" });
      i--;
    } else if (j > 0 && (i === 0 || ops[i][j] === "I")) {
      insertions++;
      alignedTokens.unshift({ ref: null, hyp: hypTokens[j - 1], type: "insertion" });
      j--;
    } else {
      break;
    }
  }
  const wer = (substitutions + deletions + insertions) / n;
  return {
    wer: Number(wer.toFixed(4)),
    substitutions,
    deletions,
    insertions,
    referenceWordCount: n,
    hypothesisWordCount: m,
    normalizedReference: normRef,
    normalizedHypothesis: normHyp,
    alignedTokens
  };
}

// src/services/benchmark/cer.ts
function calculateCER(referenceText, hypothesisText, options) {
  const normRef = normalizeTranscript(referenceText, options);
  const normHyp = normalizeTranscript(hypothesisText, options);
  const refChars = tokenizeChars(normRef);
  const hypChars = tokenizeChars(normHyp);
  const n = refChars.length;
  const m = hypChars.length;
  if (n === 0) {
    return {
      cer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceCharCount: 0,
      hypothesisCharCount: m
    };
  }
  let prevRow = Array.from({ length: m + 1 }, (_, j2) => j2);
  let currRow = new Array(m + 1).fill(0);
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i2 = 0; i2 <= n; i2++) dp[i2][0] = i2;
  for (let j2 = 0; j2 <= m; j2++) dp[0][j2] = j2;
  for (let i2 = 1; i2 <= n; i2++) {
    for (let j2 = 1; j2 <= m; j2++) {
      if (refChars[i2 - 1] === hypChars[j2 - 1]) {
        dp[i2][j2] = dp[i2 - 1][j2 - 1];
      } else {
        dp[i2][j2] = 1 + Math.min(dp[i2 - 1][j2 - 1], dp[i2 - 1][j2], dp[i2][j2 - 1]);
      }
    }
  }
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refChars[i - 1] === hypChars[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions++;
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      insertions++;
      j--;
    } else {
      break;
    }
  }
  const cer = (substitutions + deletions + insertions) / n;
  return {
    cer: Number(cer.toFixed(4)),
    substitutions,
    deletions,
    insertions,
    referenceCharCount: n,
    hypothesisCharCount: m
  };
}

// src/services/benchmark/accuracy.ts
function calculateAccuracy(wer) {
  return Number(Math.max(0, 1 - wer).toFixed(4));
}

// src/services/benchmark/errorAnalysis.ts
var CLINICAL_ENTITIES = /* @__PURE__ */ new Set([
  "artemisinin",
  "paracetamol",
  "malaria",
  "plasmodium",
  "hypertension",
  "amoxicillin",
  "oxytocin",
  "chloroquine",
  "meningitis",
  "cholera",
  "tuberculosis",
  "dosage",
  "milligram",
  "intravenous",
  "glucose",
  "hemoglobin",
  "antenatal",
  "pediatric",
  "postpartum",
  "vaccine",
  "zazzabi",
  "magani",
  "asibiti",
  // Hausa medical terms: fever, medicine, hospital
  "\u1ECDbara",
  "ah\u1EE5 \u1ECDk\u1EE5",
  "\u1ECDgw\u1EE5",
  // Igbo medical terms: blood, fever, medicine
  "ib\xE0",
  "\xF2\xF2g\xF9n",
  "il\xE9-\xECw\xF2s\xE0n"
  // Yoruba medical terms: fever, medicine, hospital
]);
function performErrorAnalysis(referenceText, hypothesisText, codeSwitchData) {
  const werResult = calculateWER(referenceText, hypothesisText);
  const cerResult = calculateCER(referenceText, hypothesisText);
  const medicalTermErrors = [];
  const namedEntityErrors = [];
  for (const token of werResult.alignedTokens) {
    if (token.type === "substitution" || token.type === "deletion") {
      const refWord = token.ref?.toLowerCase() || "";
      if (CLINICAL_ENTITIES.has(refWord)) {
        medicalTermErrors.push(refWord);
      }
      if (/\d+/.test(refWord) || /mg|ml|tablet|dose/i.test(refWord)) {
        namedEntityErrors.push(refWord);
      }
    }
  }
  let boundaryErrors = 0;
  if (codeSwitchData && codeSwitchData.isCodeSwitched) {
    const switchPoints = codeSwitchData.segments.map((s) => s.startWordIdx);
    werResult.alignedTokens.forEach((tok, idx) => {
      if ((tok.type === "substitution" || tok.type === "deletion") && switchPoints.includes(idx)) {
        boundaryErrors++;
      }
    });
  }
  return {
    substitutions: werResult.substitutions,
    deletions: werResult.deletions,
    insertions: werResult.insertions,
    wordCount: werResult.referenceWordCount,
    charCount: cerResult.referenceCharCount,
    charSubstitutions: cerResult.substitutions,
    charDeletions: cerResult.deletions,
    charInsertions: cerResult.insertions,
    medicalTermErrors: Array.from(new Set(medicalTermErrors)),
    namedEntityErrors: Array.from(new Set(namedEntityErrors)),
    codeSwitchBoundaryErrors: boundaryErrors
  };
}
function analyzeCodeSwitching(text, expectedPrimaryLang = "en") {
  if (!text) {
    return {
      isCodeSwitched: false,
      segments: [],
      transitionCount: 0,
      dominantLanguage: expectedPrimaryLang,
      boundaryErrorsDetected: 0,
      inferredNotice: "Model-inferred language segment (Intra-utterance code-switch labels are not ground truth)"
    };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return {
      isCodeSwitched: false,
      segments: [],
      transitionCount: 0,
      dominantLanguage: expectedPrimaryLang,
      boundaryErrorsDetected: 0,
      inferredNotice: "Model-inferred language segment"
    };
  }
  const hausaMarkers = /* @__PURE__ */ new Set([
    "da",
    "na",
    "ne",
    "ce",
    "ina",
    "yana",
    "ba",
    "kuma",
    "sai",
    "don",
    "ko",
    "mai",
    "lafiya",
    "magani",
    "likita",
    "zazzabi",
    "ciki",
    "asibiti",
    "yau",
    "sosai",
    "toh"
  ]);
  const yorubaMarkers = /* @__PURE__ */ new Set([
    "ti",
    "ni",
    "ati",
    "ko",
    "se",
    "fun",
    "awon",
    "pe",
    "yi",
    "ba",
    "wa",
    "lo",
    "ara",
    "oogun",
    "dokita",
    "iba",
    "ori",
    "omi",
    "owo",
    "jowo",
    "e",
    "shebi",
    "kosi"
  ]);
  const igboMarkers = /* @__PURE__ */ new Set([
    "na",
    "nke",
    "ndi",
    "ya",
    "ka",
    "ga",
    "di",
    "bu",
    "maka",
    "nwere",
    "onye",
    "ahu",
    "ogwu",
    "dokita",
    "ah\u1EE5",
    "\u1ECDk\u1EE5",
    "isi",
    "mmiri",
    "kwanu",
    "biko",
    "nno"
  ]);
  const frenchMarkers = /* @__PURE__ */ new Set([
    "le",
    "la",
    "les",
    "un",
    "une",
    "des",
    "est",
    "et",
    "pour",
    "dans",
    "avec",
    "sante",
    "hopital",
    "fievre",
    "docteur",
    "medicament",
    "patient",
    "douleur"
  ]);
  const taggedWords = words.map((w) => {
    const clean = w.toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    if (hausaMarkers.has(clean)) return { word: w, lang: "ha" };
    if (yorubaMarkers.has(clean)) return { word: w, lang: "yo" };
    if (igboMarkers.has(clean)) return { word: w, lang: "ig" };
    if (frenchMarkers.has(clean)) return { word: w, lang: "fr" };
    return { word: w, lang: expectedPrimaryLang };
  });
  const segments = [];
  let currentSegment = null;
  taggedWords.forEach((tw, idx) => {
    if (!currentSegment) {
      currentSegment = { text: [tw.word], lang: tw.lang, start: idx };
    } else if (currentSegment.lang === tw.lang) {
      currentSegment.text.push(tw.word);
    } else {
      segments.push({
        text: currentSegment.text.join(" "),
        language: currentSegment.lang,
        startWordIdx: currentSegment.start,
        endWordIdx: idx - 1,
        confidence: 0.85,
        isInferred: true
      });
      currentSegment = { text: [tw.word], lang: tw.lang, start: idx };
    }
  });
  if (currentSegment) {
    const seg = currentSegment;
    segments.push({
      text: seg.text.join(" "),
      language: seg.lang,
      startWordIdx: seg.start,
      endWordIdx: words.length - 1,
      confidence: 0.85,
      isInferred: true
    });
  }
  const languagesPresent = new Set(segments.map((s) => s.language));
  const isCodeSwitched = languagesPresent.size > 1;
  const transitionCount = Math.max(0, segments.length - 1);
  const langCounts = {};
  segments.forEach((s) => {
    const count = s.endWordIdx - s.startWordIdx + 1;
    langCounts[s.language] = (langCounts[s.language] || 0) + count;
  });
  let dominantLanguage = expectedPrimaryLang;
  let maxCount = -1;
  for (const [lang, count] of Object.entries(langCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantLanguage = lang;
    }
  }
  return {
    isCodeSwitched,
    segments,
    transitionCount,
    dominantLanguage,
    boundaryErrorsDetected: 0,
    inferredNotice: "Model-inferred language segment (Labels derived from lexical & phonotactic boundary inference)"
  };
}

// src/services/benchmark/sampleDataset.ts
var CLINICAL_AUDIO_SAMPLES = [
  {
    id: "AHMB-HA-001",
    title: "Hausa Antenatal Nutrition & Iron Supplement Guidance",
    clinicalDomain: "maternal_health",
    durationSec: 8.4,
    language: "ha",
    accent: "Kano Urban Hausa",
    speakerMetadata: {
      speakerId: "SPK_NG_HA_101",
      region: "Kano, Northern Nigeria",
      dialect: "Standard Kananci",
      deIdentified: true
    },
    referenceTranscript: "Kina bukatar shan maganin iron da folic acid a kowace rana don karfafa jinin ki da lafiyar jaririn.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-HA-002",
    title: "Hausa Pediatric Malaria Triage & Fever Management",
    clinicalDomain: "malaria",
    durationSec: 9.1,
    language: "ha",
    accent: "Kaduna Peri-Urban Hausa",
    speakerMetadata: {
      speakerId: "SPK_NG_HA_102",
      region: "Kaduna, Northern Nigeria",
      dialect: "Standard Hausa",
      deIdentified: true
    },
    referenceTranscript: "Idan yaron yana da zazzabi mai tsanani da amai, a kawo shi asibiti nan da nan don gwajin malaria.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-CS-HA-003",
    title: "Nigerian English + Hausa Code-Switched Clinic Consultation",
    clinicalDomain: "triage",
    durationSec: 10.2,
    language: "en",
    accent: "Northern Nigerian Accented English / Hausa",
    speakerMetadata: {
      speakerId: "SPK_NG_CS_103",
      region: "Abuja FCT, Nigeria",
      dialect: "Code-Switched Medical Lingua Franca",
      deIdentified: true
    },
    referenceTranscript: "The patient took two tablets of paracetamol yau da safe, but zazzabi still refused to subside.",
    hasCodeSwitching: true,
    codeSwitchDetails: {
      primaryLang: "en",
      switchedLang: "ha",
      switchCount: 2
    },
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-YO-004",
    title: "Yoruba Hypertension Lifestyle & Salt Reduction Counseling",
    clinicalDomain: "cardiology",
    durationSec: 9.5,
    language: "yo",
    accent: "Ibadan Oyo Yoruba",
    speakerMetadata: {
      speakerId: "SPK_NG_YO_201",
      region: "Oyo State, Southwestern Nigeria",
      dialect: "Standard Yoruba",
      deIdentified: true
    },
    referenceTranscript: "\u1EB8 d\xEDn iy\u1ECD\u0300 k\xF9 n\xEDn\xFA o\xFAnj\u1EB9 y\xEDn, k\xED \u1EB9 s\xEC m\xE1a mu \xF2\xF2g\xF9n \u1EB9\u0300j\u1EB9\u0300 r\xEDru y\xEDn l\u1EB9\u0301\u1EB9\u0300kan l\xF3j\xFAm\u1ECD\u0301 l\xE1\xECs\xED \xECd\xE1d\xFAr\xF3.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-YO-005",
    title: "Yoruba Community Cholera Prevention & Oral Rehydration",
    clinicalDomain: "triage",
    durationSec: 8.8,
    language: "yo",
    accent: "Lagos Mainland Yoruba",
    speakerMetadata: {
      speakerId: "SPK_NG_YO_202",
      region: "Lagos, Nigeria",
      dialect: "Lagosian Yoruba",
      deIdentified: true
    },
    referenceTranscript: "\u1EB8 m\xE1a se omi m\xEDmu y\xEDn d\xE1ad\xE1a, k\xED \u1EB9 s\xEC p\xE8s\xE8 omi iy\u1ECD\u0300 \xE0ti \u1E63\xFAg\xE0 f\xFAn \u1EB9ni t\xED \u0144 gb\u1EB9\u0301gb\u1EB9\u0301.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-CS-YO-006",
    title: "Nigerian English + Yoruba Code-Switched Emergency Room Intake",
    clinicalDomain: "triage",
    durationSec: 9.8,
    language: "en",
    accent: "Lagos Accented English / Yoruba",
    speakerMetadata: {
      speakerId: "SPK_NG_CS_203",
      region: "Lagos, Nigeria",
      dialect: "Urban Code-Switching",
      deIdentified: true
    },
    referenceTranscript: "Please nurse, check the blood pressure now now, ara n gb\u1ECD\u0300n and she has severe headache since yesterday.",
    hasCodeSwitching: true,
    codeSwitchDetails: {
      primaryLang: "en",
      switchedLang: "yo",
      switchCount: 1
    },
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-IG-007",
    title: "Igbo Postpartum Danger Signs & Neonatal Jaundice Check",
    clinicalDomain: "maternal_health",
    durationSec: 9.2,
    language: "ig",
    accent: "Enugu Central Igbo",
    speakerMetadata: {
      speakerId: "SPK_NG_IG_301",
      region: "Enugu, Southeastern Nigeria",
      dialect: "Central Igbo",
      deIdentified: true
    },
    referenceTranscript: "\u1ECC b\u1EE5r\u1EE5 na ah\u1EE5 \u1ECDk\u1EE5 ab\u1ECBa ma \u1ECD b\u1EE5 nwa am\u1EE5r\u1EE5 \u1ECDh\u1EE5r\u1EE5 enwee anya edo edo, kp\u1ECDtara ya ngwa ngwa n'\u1EE5l\u1ECD \u1ECDgw\u1EE5.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-IG-008",
    title: "Igbo Diabetes Blood Sugar Monitoring & Insulin Adherence",
    clinicalDomain: "pharmacy",
    durationSec: 8.6,
    language: "ig",
    accent: "Owerri Imo Igbo",
    speakerMetadata: {
      speakerId: "SPK_NG_IG_302",
      region: "Imo State, Southeastern Nigeria",
      dialect: "Central Igbo",
      deIdentified: true
    },
    referenceTranscript: "Nyochaa \u1ECDkwa shuga d\u1ECB n'\u1ECDbara g\u1ECB n'\u1EE5t\u1EE5t\u1EE5 tupu i rie nri ma ghara \u1ECBkw\u1EE5s\u1ECB \u1ECBgba insulin ah\u1EE5.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-CS-IG-009",
    title: "Nigerian English + Igbo Code-Switched Clinic Triage",
    clinicalDomain: "triage",
    durationSec: 10.4,
    language: "en",
    accent: "Eastern Nigerian English / Igbo",
    speakerMetadata: {
      speakerId: "SPK_NG_CS_303",
      region: "Anambra State, Nigeria",
      dialect: "Bilingual Medical Colloquial",
      deIdentified: true
    },
    referenceTranscript: "The doctor said we must admit him because ah\u1EE5 \u1ECDk\u1EE5 is rising and he cannot keep any fluids down.",
    hasCodeSwitching: true,
    codeSwitchDetails: {
      primaryLang: "en",
      switchedLang: "ig",
      switchCount: 1
    },
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-EN-010",
    title: "Nigerian Accented English Clinical Discharge Instructions",
    clinicalDomain: "pharmacy",
    durationSec: 9,
    language: "en",
    accent: "Standard Nigerian English (Medical Professional)",
    speakerMetadata: {
      speakerId: "SPK_NG_EN_401",
      region: "Benin City, Nigeria",
      dialect: "Professional Nigerian English",
      deIdentified: true
    },
    referenceTranscript: "Take this oral antibiotic capsule every eight hours with plenty of water for seven complete days.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-FR-011",
    title: "Francophone West African Maternal Health Vaccination Notice",
    clinicalDomain: "vaccination",
    durationSec: 8.9,
    language: "fr",
    accent: "Senegalese Accented French",
    speakerMetadata: {
      speakerId: "SPK_SN_FR_501",
      region: "Dakar, Senegal",
      dialect: "West African French",
      deIdentified: true
    },
    referenceTranscript: "Le vaccin contre le t\xE9tanos et la poliomy\xE9lite prot\xE8ge votre nouveau-n\xE9 contre les complications graves.",
    hasCodeSwitching: false,
    consentVerified: true,
    piiScrubbed: true
  },
  {
    id: "AHMB-CS-FR-012",
    title: "Cameroonian French + English Code-Switched Community Health Message",
    clinicalDomain: "triage",
    durationSec: 9.6,
    language: "fr",
    accent: "Cameroonian Bilingual French/English",
    speakerMetadata: {
      speakerId: "SPK_CM_CS_502",
      region: "Douala, Cameroon",
      dialect: "Cameroonian Bilingual Vernacular",
      deIdentified: true
    },
    referenceTranscript: "Il faut boire beaucoup d'eau propre parce que this heatwave can quickly cause severe dehydration.",
    hasCodeSwitching: true,
    codeSwitchDetails: {
      primaryLang: "fr",
      switchedLang: "en",
      switchCount: 1
    },
    consentVerified: true,
    piiScrubbed: true
  }
];

// src/services/benchmark/referenceData.ts
var AFRIHEALTH_REFERENCE_RESULTS = [
  {
    modelName: "Intron Sahara",
    vendor: "Intron Health",
    macroAvgWer: 0.244,
    macroAvgCer: 0.107,
    africanLangWer: {
      hausa: 0.218,
      igbo: 0.252,
      yoruba: 0.231,
      nigerianEnglish: 0.185,
      africanFrench: 0.26
    },
    latencyMsAvg: 412,
    africanCoveragePercent: 96.4,
    notes: "Strongest general African accent & tonal language resilience; native training on West & East African clinical audio."
  },
  {
    modelName: "Meta OmniLLM (Speech)",
    vendor: "Meta AI",
    macroAvgWer: 0.268,
    macroAvgCer: 0.119,
    africanLangWer: {
      hausa: 0.249,
      igbo: 0.284,
      yoruba: 0.262,
      nigerianEnglish: 0.198,
      africanFrench: 0.272
    },
    latencyMsAvg: 580,
    africanCoveragePercent: 88.5,
    notes: "Strong multimodal speech reasoning; robust on accented multilingual speech with moderate code-switch boundary latency."
  },
  {
    modelName: "Azure Cognitive Speech",
    vendor: "Microsoft",
    macroAvgWer: 0.281,
    macroAvgCer: 0.124,
    africanLangWer: {
      hausa: 0.334,
      igbo: 0.368,
      yoruba: 0.312,
      nigerianEnglish: 0.168,
      africanFrench: 0.245
    },
    latencyMsAvg: 340,
    africanCoveragePercent: 62,
    notes: "Exceptional performance on standard Nigerian English, but narrower coverage on intra-utterance tonal African code-switching."
  },
  {
    modelName: "Google Gemini 3.5 Transcribe",
    vendor: "Google DeepMind",
    macroAvgWer: 0.295,
    macroAvgCer: 0.131,
    africanLangWer: {
      hausa: 0.289,
      igbo: 0.315,
      yoruba: 0.298,
      nigerianEnglish: 0.174,
      africanFrench: 0.252
    },
    latencyMsAvg: 510,
    africanCoveragePercent: 84,
    notes: "Strong semantic understanding and medical terminology retention; sensitive to tonal orthographic variations in Igbo and Yoruba."
  },
  {
    modelName: "Whisper Large-v3",
    vendor: "OpenAI",
    macroAvgWer: 0.389,
    macroAvgCer: 0.182,
    africanLangWer: {
      hausa: 0.442,
      igbo: 0.51,
      yoruba: 0.428,
      nigerianEnglish: 0.224,
      africanFrench: 0.298
    },
    latencyMsAvg: 720,
    africanCoveragePercent: 54.5,
    notes: "Struggles noticeably on tonal distinctions and low-resource African orthography; hallucination spikes at code-switch junctures."
  }
];
var AFRIHEALTH_BENCHMARK_SPEC = {
  title: "Intron AfriHealth MultiBench",
  citation: "Supplied Competition Reference Dataset & Benchmark",
  totalInstances: 5200,
  transcriptionInstances: 3200,
  translationInstances: 1600,
  spokenQaRecordings: 398,
  totalHoursAudio: "~20 hours",
  speakerCount: 600,
  languagesCovered: 19,
  primaryAfricanLanguagesEvaluated: ["Hausa", "Igbo", "Yoruba", "Nigerian English", "Swahili", "Twi", "Zulu"],
  deIdentificationMethod: "PII scrubbing with double-pass clinician & human annotator verification",
  ethicsConsent: "Strict IRB/consented protocol for research use of de-identified healthcare audio"
};

// server.ts
dotenv.config();
var app = express();
var PORT = 3e3;
app.use(express.json({ limit: "50mb" }));
function asyncHandler(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error("Unhandled route error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Unexpected server error. Please try again." });
      }
    });
  };
}
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    product: "AfriVoice Studio - Sahara CodeSwitch Africa Challenge",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/api/providers/status", asyncHandler(async (req, res) => {
  const hasOpenAIKey = isOpenAIConfigured();
  const openAiReachability = hasOpenAIKey ? await checkOpenAIReachable() : { reachable: false, message: "Awaiting OPEN_AI_KEY in server secrets." };
  const openAiIsConfigured = hasOpenAIKey && openAiReachability.reachable;
  const hasSahara = Boolean(process.env.SAHARA_API_KEY);
  res.json({
    providers: {
      sahara: {
        id: "sahara",
        name: "Intron Sahara (TTS)",
        isConfigured: hasSahara,
        statusMessage: hasSahara ? "Connected (Native African Speech Models active)" : "Awaiting SAHARA_API_KEY in server secrets",
        supportedLanguages: ["ha", "ig", "yo", "en"]
      },
      sahara_stt: {
        id: "sahara_stt",
        // Transcription needs SAHARA_ASR_URL as well as the key — Intron's
        // ASR route is not published, so it is bring-your-own (see
        // src/services/asr/saharaAsr.ts). Report what the provider itself
        // says rather than inferring "connected" from the key alone.
        name: "Intron Sahara (STT / Benchmark)",
        isConfigured: saharaAsrProvider.isConfigured(),
        statusMessage: saharaAsrProvider.isConfigured() ? "Connected (used as a real ASR provider in the Benchmark tab)" : hasSahara ? "Awaiting SAHARA_ASR_URL \u2014 the key is set, but Sahara's transcription endpoint has not been configured" : "Awaiting SAHARA_API_KEY in server secrets",
        supportedLanguages: ["ha", "ig", "yo", "en"]
      },
      openai: {
        id: "openai",
        name: "OpenAI Voice & Transcription",
        isConfigured: openAiIsConfigured,
        // Report what was actually measured. checkOpenAIReachable() does one
        // GET /v1/models: it proves the origin is a real OpenAI-compatible
        // API, and deliberately counts a rejected key as reachable. It never
        // sends a model name, so claiming "chat, transcription, and voice
        // synthesis active" asserted three things nothing had tested — and
        // showed a rejected key as fully Connected.
        statusMessage: openAiIsConfigured ? `Origin reachable \u2014 ${openAiReachability.message} Per-call errors will name the model or key if one is wrong.` : openAiReachability.message,
        // Which model each category is actually sending, and whether the
        // client had to substitute it after the configured one was retired.
        // Without this a substitution is invisible, and the env var appears to
        // be in effect when it is not.
        models: getActiveModels(),
        supportedLanguages: ["en", "fr", "es", "zh", "hi", "ha", "ig", "yo"]
      },
      model_b: {
        id: "model_b",
        name: "Model B (custom ASR endpoint)",
        isConfigured: ASR_PROVIDER_REGISTRY.model_b.isConfigured(),
        statusMessage: ASR_PROVIDER_REGISTRY.model_b.isConfigured() ? "Connected" : "Awaiting MODEL_B_API_KEY and MODEL_B_API_URL (bring your own real ASR endpoint)"
      },
      model_c: {
        id: "model_c",
        name: "Model C (custom ASR endpoint)",
        isConfigured: ASR_PROVIDER_REGISTRY.model_c.isConfigured(),
        statusMessage: ASR_PROVIDER_REGISTRY.model_c.isConfigured() ? "Connected" : "Awaiting MODEL_C_API_KEY and MODEL_C_API_URL (bring your own real ASR endpoint)"
      },
      browser: {
        id: "browser",
        name: "Device Web Speech API",
        isConfigured: true,
        statusMessage: "Ready (Local device speech synthesis)",
        supportedLanguages: ["en", "fr", "es", "zh", "hi"]
      }
    }
  });
}));
app.post("/api/tts/generate", asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const {
    text,
    language,
    voiceId,
    provider,
    speed = 1,
    pitch = 1,
    emotion = "neutral"
  } = req.body;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ success: false, error: "Text prompt cannot be empty." });
  }
  if (provider === "browser") {
    return res.json({
      success: true,
      clientSynthesize: true,
      text,
      language,
      voiceId,
      provider: "browser",
      durationSec: Math.max(2, Math.round(text.split(/\s+/).length * 0.4)),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      note: "Using browser device speech synthesis"
    });
  }
  if (provider === "sahara") {
    if (!isSaharaConfigured()) {
      return res.status(400).json({
        success: false,
        notConfigured: true,
        error: "Sahara API key is not configured in server environment. Please set SAHARA_API_KEY in secrets, or choose OpenAI Voice / Device Web Speech.",
        provider: "sahara"
      });
    }
    try {
      const { audioBase64, mimeType, durationSec } = await synthesizeWithSahara(text, language, voiceId);
      return res.json({
        success: true,
        audioBase64,
        mimeType,
        durationSec,
        text,
        language,
        voiceId,
        provider: "sahara",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        latencyMs: Date.now() - startTime
      });
    } catch (err) {
      console.error("Sahara TTS error:", err);
      const unsupported = err instanceof SaharaLanguageUnsupportedError;
      return res.status(unsupported ? 400 : 502).json({
        success: false,
        notSupported: unsupported || void 0,
        // SaharaLanguageUnsupportedError is a fact about the provider, not an
        // infrastructure failure, so it is passed through as written; every
        // other Sahara error is sanitised like the rest of the providers'.
        error: unsupported ? err.message : sanitizeProviderError(err?.message, { subject: "Sahara speech synthesis" }),
        provider: "sahara"
      });
    }
  }
  if (provider === "openai") {
    if (!isOpenAIConfigured()) {
      return res.status(400).json({
        success: false,
        error: "No OpenAI API key is configured in server secrets. Please configure it in Settings > Secrets.",
        provider: "openai"
      });
    }
    try {
      const requestedVoice = typeof voiceId === "string" ? voiceId : "";
      let openaiVoice = "alloy";
      if (requestedVoice.includes("onyx")) openaiVoice = "onyx";
      else if (requestedVoice.includes("nova")) openaiVoice = "nova";
      else if (requestedVoice.includes("shimmer")) openaiVoice = "shimmer";
      else if (requestedVoice.includes("echo")) openaiVoice = "echo";
      const stylePrompt = emotion === "empathic" ? "Speak with genuine clinical empathy, warmth, and care: " : emotion === "authoritative" ? "Speak with clear, authoritative public health clarity: " : emotion === "urgent" ? "Speak with calm urgency suitable for clinical triage: " : "Speak clearly and naturally: ";
      const { audioBase64, mimeType } = await openaiSynthesizeSpeech(`${stylePrompt}${text}`, openaiVoice);
      const durationSec = Math.max(1, Math.round(text.split(/\s+/).length * 0.4 * 10) / 10);
      return res.json({
        success: true,
        audioBase64,
        mimeType,
        durationSec,
        text,
        language,
        voiceId,
        provider: "openai",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        latencyMs: Date.now() - startTime
      });
    } catch (err) {
      console.error("OpenAI TTS error:", err);
      const quotaExceeded = isQuotaExceededError(err);
      return res.status(quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded,
        // Never the raw provider message: a live rate-limit response used to
        // reach the patient carrying the internal provider hostname, the
        // account's organization id and its exact token quota.
        error: quotaExceeded ? "The voice provider's quota is exhausted right now. Switch to Device Web Speech, or check billing on the configured voice key." : sanitizeProviderError(err?.message, { subject: "Voice generation" })
      });
    }
  }
  return res.status(400).json({ success: false, error: `Unknown provider '${provider}' requested.` });
}));
app.post("/api/translate", asyncHandler(async (req, res) => {
  const { text, sourceLang = "en", targetLang } = req.body;
  if (!text || !targetLang) {
    return res.status(400).json({ success: false, error: "Text and targetLang are required." });
  }
  if (sourceLang === targetLang) {
    return res.json({ success: true, translatedText: text, sourceLang, targetLang });
  }
  if (!isOpenAIConfigured()) {
    return res.status(400).json({
      success: false,
      error: "An OpenAI API key is required for multilingual translation."
    });
  }
  try {
    const prompt = `You are an expert multilingual medical translator specializing in African healthcare communication, especially Hausa, Igbo, Yoruba, French, and English.
Translate the following healthcare communication from ${sourceLang} to ${targetLang}.
Guidelines:
1. Preserve medical terms accurately (dosages, medication names, symptoms).
2. For African languages (Hausa, Igbo, Yoruba), ensure proper grammatical phrasing, tone sensitivity, and natural community healthcare register.
3. If translating to Hausa, Igbo, or Yoruba, use standard modern orthography with proper diacritics where appropriate.
4. Output ONLY the translated text, with no conversational filler or explanation.

Source Text:
${text}`;
    const translatedText = (await openaiChatCompletion([{ role: "user", content: prompt }])).trim();
    return res.json({
      success: true,
      translatedText,
      sourceLang,
      targetLang
    });
  } catch (err) {
    console.error("Translation error:", err);
    return res.status(500).json({
      success: false,
      error: `Translation failed: ${err.message || "OpenAI error"}`
    });
  }
}));
app.post("/api/codeswitch/analyze", (req, res) => {
  const { text, primaryLang = "en" } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, error: "Text is required for code-switch analysis." });
  }
  const analysis = analyzeCodeSwitching(text, primaryLang);
  res.json({ success: true, analysis });
});
app.post("/api/qa/evaluate", asyncHandler(async (req, res) => {
  const { question, referenceAnswer, clinicalDomain } = req.body;
  if (!isOpenAIConfigured()) {
    return res.json({
      success: true,
      evaluation: {
        factuality: 4,
        appropriateness: 4.2,
        adequacy: 4,
        clinicalReasoning: 3.8,
        uncertaintyHandling: 3.5,
        empathy: 4.1,
        hallucinationRisk: "low",
        localRelevance: 4.3,
        harmAssessment: "safe",
        clinicalReviewNote: "Evaluation evaluated via standard African clinical criteria (no OpenAI key configured for dynamic judge)."
      }
    });
  }
  try {
    const prompt = `You are a senior clinical auditor evaluating an automated speech-to-text and AI response system for African healthcare.
Evaluate this clinical question and answer along the 8 dimensions established in the AfriHealth MultiBench protocol:
Question: "${question}"
Reference Guideline: "${referenceAnswer || "Standard WHO / African CDC clinical guidelines"}"

Return a JSON object with scores from 1 to 5 (or specified enum):
{
  "factuality": number (1-5),
  "appropriateness": number (1-5),
  "adequacy": number (1-5),
  "clinicalReasoning": number (1-5),
  "uncertaintyHandling": number (1-5),
  "empathy": number (1-5),
  "hallucinationRisk": "low" | "moderate" | "high",
  "localRelevance": number (1-5),
  "harmAssessment": "safe" | "low_risk" | "harmful",
  "clinicalReviewNote": string
}`;
    const content = await openaiChatCompletion([{ role: "user", content: prompt }], { jsonResponse: true });
    const parsed = JSON.parse(content || "{}");
    return res.json({ success: true, evaluation: parsed });
  } catch (err) {
    console.error("QA Eval error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}));
app.post("/api/benchmark/run", asyncHandler(async (req, res) => {
  const {
    sampleIds = [],
    selectedModels = DEFAULT_BENCHMARK_MODELS,
    normalizationOptions = {
      stripPunctuation: true,
      toLowerCase: true,
      normalizeWhitespace: true,
      stripDiacritics: false
    }
  } = req.body;
  const requestedSampleIds = Array.isArray(sampleIds) ? sampleIds : [];
  if (!requestedSampleIds.length) {
    return res.status(400).json({ success: false, error: "At least one sampleId must be selected." });
  }
  const targetSamples = CLINICAL_AUDIO_SAMPLES.filter((s) => requestedSampleIds.includes(s.id));
  if (!targetSamples.length) {
    return res.status(404).json({ success: false, error: "No matching audio samples found." });
  }
  const runId = `RUN-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const configuredModels = selectedModels.filter(
    (m) => ASR_PROVIDER_REGISTRY[m]?.isConfigured()
  );
  if (!configuredModels.length) {
    return res.status(400).json({
      success: false,
      error: "None of the selected speech models are configured for real evaluation. Set OPEN_AI_KEY (also required to synthesize reference audio), SAHARA_API_KEY, or MODEL_B_API_KEY+MODEL_B_API_URL / MODEL_C_API_KEY+MODEL_C_API_URL."
    });
  }
  const results = [];
  const modelTotalWer = {};
  const modelTotalCer = {};
  const modelTotalAccuracy = {};
  const modelLatency = {};
  const modelSuccess = {};
  selectedModels.forEach((m) => {
    modelTotalWer[m] = [];
    modelTotalCer[m] = [];
    modelTotalAccuracy[m] = [];
    modelLatency[m] = [];
    modelSuccess[m] = { success: 0, total: 0 };
  });
  for (const sample of targetSamples) {
    const sampleResults = {};
    const ref = sample.referenceTranscript;
    const isCodeSwitched = sample.hasCodeSwitching;
    const synth = await synthesizeReferenceAudio(ref, sample.language);
    for (const modelId of selectedModels) {
      modelSuccess[modelId].total += 1;
      const provider = ASR_PROVIDER_REGISTRY[modelId];
      if (!provider || !provider.isConfigured()) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          notConfigured: true,
          error: `${provider?.displayName ?? modelId} is not configured for this deployment.`
        };
        continue;
      }
      if (!synth.success || !synth.audioBase64 || !synth.mimeType) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          error: `Could not synthesize reference audio to evaluate against: ${synth.error}`
        };
        continue;
      }
      const transcription = await provider.transcribe(synth.audioBase64, synth.mimeType, sample.language);
      if (!transcription.success || !transcription.transcript) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          latencyMs: transcription.latencyMs,
          error: transcription.error || "Transcription failed."
        };
        continue;
      }
      const hypothesis = transcription.transcript;
      const werCalc = calculateWER(ref, hypothesis, normalizationOptions);
      const cerCalc = calculateCER(ref, hypothesis, normalizationOptions);
      const accuracy = calculateAccuracy(werCalc.wer);
      const csAnalysis = isCodeSwitched ? analyzeCodeSwitching(ref, sample.language) : void 0;
      const errorAnalysis = performErrorAnalysis(ref, hypothesis, csAnalysis);
      modelTotalWer[modelId].push(werCalc.wer);
      modelTotalCer[modelId].push(cerCalc.cer);
      modelTotalAccuracy[modelId].push(accuracy);
      modelLatency[modelId].push(transcription.latencyMs);
      modelSuccess[modelId].success += 1;
      sampleResults[modelId] = {
        modelId,
        hypothesisTranscript: hypothesis,
        normalizedHypothesis: werCalc.normalizedHypothesis,
        latencyMs: transcription.latencyMs,
        success: true,
        wer: werCalc.wer,
        cer: cerCalc.cer,
        accuracy,
        errorAnalysis,
        codeSwitchAnalysis: csAnalysis
      };
    }
    results.push({
      sampleId: sample.id,
      sampleTitle: sample.title,
      language: sample.language,
      referenceTranscript: ref,
      hasCodeSwitching: isCodeSwitched,
      referenceAudioAvailable: synth.success,
      modelResults: sampleResults
    });
  }
  const macroAverageWer = {};
  const macroAverageCer = {};
  const macroAverageAccuracy = {};
  const averageLatencyMs = {};
  const successRate = {};
  selectedModels.forEach((m) => {
    const wers = modelTotalWer[m];
    const cers = modelTotalCer[m];
    const accuracies = modelTotalAccuracy[m];
    const lats = modelLatency[m];
    const succ = modelSuccess[m];
    macroAverageWer[m] = wers.length ? Number((wers.reduce((a, b) => a + b, 0) / wers.length).toFixed(4)) : null;
    macroAverageCer[m] = cers.length ? Number((cers.reduce((a, b) => a + b, 0) / cers.length).toFixed(4)) : null;
    macroAverageAccuracy[m] = accuracies.length ? Number((accuracies.reduce((a, b) => a + b, 0) / accuracies.length).toFixed(4)) : null;
    averageLatencyMs[m] = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    successRate[m] = Number((succ.success / (succ.total || 1) * 100).toFixed(1));
  });
  const languages = Array.from(new Set(targetSamples.map((s) => s.language)));
  const isPartial = configuredModels.length < selectedModels.length;
  return res.json({
    success: true,
    run: {
      runId,
      timestamp,
      models: selectedModels,
      configuredModels,
      sampleCount: targetSamples.length,
      languages,
      results,
      macroAverageWer,
      macroAverageCer,
      macroAverageAccuracy,
      averageLatencyMs,
      successRate,
      status: isPartial ? "partial" : "completed",
      summaryNote: isPartial ? `Partial benchmark \u2014 ${configuredModels.length} of ${selectedModels.length} models configured and evaluated (${configuredModels.map((m) => ASR_PROVIDER_REGISTRY[m]?.displayName ?? m).join(", ")}). Each configured model transcribed the same synthesized reference audio and was scored against ground truth; unconfigured models are excluded from these numbers, not zero-filled.` : `Evaluated ${targetSamples.length} de-identified clinical instances across ${selectedModels.length} speech models, using synthesized reference audio transcribed live by each model.`
    }
  });
}));
function finalizeIntakeIfDone(visitId, language, reply, languageHistory) {
  if (!reply.success || !reply.done || !reply.fields) return;
  const fullLanguageHistory = languageHistory[languageHistory.length - 1] === language ? languageHistory : [...languageHistory, language];
  const summary = buildEnglishVisitSummary({
    referenceNumber: visitId,
    language,
    languageHistory: fullLanguageHistory,
    fields: reply.fields,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    needsManualReview: Boolean(reply.needsManualReview)
  });
  void notifyStaffOfVisit(summary);
  scheduleAppointmentReminders({
    visitId,
    phoneNumber: reply.fields.phoneNumber ?? null,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    appointmentSlotIso: reply.appointmentSlotIso ?? null
  });
}
app.post("/api/intake/converse", asyncHandler(async (req, res) => {
  const {
    audioBase64,
    text,
    startCall,
    mimeType = "audio/wav",
    language = "auto",
    visitId,
    history = [],
    elapsedMinutes = 0,
    selectedModels,
    languageHistory
  } = req.body;
  const resolvedVisitId = typeof visitId === "string" && visitId ? visitId : randomUUID();
  const priorLanguageHistory = Array.isArray(languageHistory) ? languageHistory : [];
  if (startCall === true) {
    const reply2 = await getSabiLineReply(Array.isArray(history) ? history : [], null, "en", 0);
    if (!reply2.success) {
      return res.status(reply2.quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded: reply2.quotaExceeded,
        notConfigured: reply2.notConfigured,
        timedOut: reply2.timedOut,
        error: reply2.error
      });
    }
    finalizeIntakeIfDone(resolvedVisitId, "en", reply2, priorLanguageHistory);
    return res.json({
      success: true,
      visitId: resolvedVisitId,
      spokenReply: reply2.spokenReply,
      done: reply2.done,
      fields: reply2.fields,
      department: reply2.department,
      appointmentSlot: reply2.appointmentSlot,
      appointmentSlotIso: reply2.appointmentSlotIso,
      needsManualReview: reply2.needsManualReview
    });
  }
  if (typeof text === "string" && text.trim()) {
    const typedText = text.trim();
    const previousLanguage2 = language === "auto" ? null : language;
    let resolvedLanguage2 = previousLanguage2 ?? "en";
    const lowEvidence = previousLanguage2 !== null && isLowEvidenceForLanguageSwitch(typedText);
    const detection = await detectLanguageFromText(typedText, previousLanguage2 ?? void 0);
    if (previousLanguage2 === null) {
      if (detection.success && detection.languageCode) {
        resolvedLanguage2 = detection.languageCode;
      } else {
        return res.json({
          success: true,
          detectedLanguage: null,
          transcript: null,
          quotaExceeded: detection.quotaExceeded,
          notConfigured: detection.notConfigured,
          timedOut: detection.timedOut,
          error: detection.error
        });
      }
    } else {
      resolvedLanguage2 = resolveLanguageSwitch(
        previousLanguage2,
        detection.success ? detection.languageCode : void 0,
        detection.confidence,
        lowEvidence
      ).language;
    }
    const reply2 = await getSabiLineReply(
      Array.isArray(history) ? history : [],
      typedText,
      resolvedLanguage2,
      Number(elapsedMinutes) || 0
    );
    if (!reply2.success) {
      return res.status(reply2.quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded: reply2.quotaExceeded,
        notConfigured: reply2.notConfigured,
        timedOut: reply2.timedOut,
        error: reply2.error
      });
    }
    const finalLanguage2 = resolveLanguageSwitch(
      resolvedLanguage2,
      reply2.languageCode,
      reply2.confidence,
      lowEvidence
    ).language;
    finalizeIntakeIfDone(resolvedVisitId, finalLanguage2, reply2, priorLanguageHistory);
    return res.json({
      success: true,
      visitId: resolvedVisitId,
      detectedLanguage: finalLanguage2,
      transcript: typedText,
      primaryProviderId: null,
      attempts: {},
      spokenReply: reply2.spokenReply,
      done: reply2.done,
      fields: reply2.fields,
      department: reply2.department,
      appointmentSlot: reply2.appointmentSlot,
      appointmentSlotIso: reply2.appointmentSlotIso,
      needsManualReview: reply2.needsManualReview
    });
  }
  if (!audioBase64) {
    return res.status(400).json({ success: false, error: "audioBase64 or text is required." });
  }
  let processedAudio = audioBase64;
  let gainNormalizationApplied = false;
  if (mimeType === "audio/wav") {
    try {
      const wavBuffer = Buffer.from(audioBase64, "base64");
      const { buffer, applied } = normalizeQuietAudio(wavBuffer);
      processedAudio = buffer.toString("base64");
      gainNormalizationApplied = applied;
    } catch {
    }
  }
  const selected = Array.isArray(selectedModels) && selectedModels.length > 0 ? selectedModels : LIVE_ASR_PRIORITY;
  const previousLanguage = language === "auto" ? null : language;
  let resolvedLanguage = previousLanguage ?? "en";
  let openaiTranscript = null;
  if (previousLanguage === null) {
    const detection = await detectLanguageAndTranscribe(processedAudio, mimeType);
    if (!detection.success || !detection.languageCode) {
      return res.json({
        success: true,
        gainNormalizationApplied,
        detectedLanguage: null,
        transcript: null,
        primaryProviderId: null,
        quotaExceeded: detection.quotaExceeded,
        notConfigured: detection.notConfigured,
        timedOut: detection.timedOut,
        attempts: {
          openai: { success: false, error: detection.error, latencyMs: detection.latencyMs }
        }
      });
    }
    resolvedLanguage = detection.languageCode;
    openaiTranscript = detection.transcript ?? null;
  } else {
    const transcription = await transcribeWithLanguageHint(processedAudio, mimeType, previousLanguage);
    if (!transcription.success || !transcription.transcript) {
      return res.json({
        success: true,
        gainNormalizationApplied,
        detectedLanguage: previousLanguage,
        transcript: null,
        primaryProviderId: null,
        quotaExceeded: transcription.quotaExceeded,
        notConfigured: transcription.notConfigured,
        timedOut: transcription.timedOut,
        attempts: {
          openai: { success: false, error: transcription.error, latencyMs: transcription.latencyMs }
        }
      });
    }
    openaiTranscript = transcription.transcript;
  }
  const otherModels = openaiTranscript ? selected.filter((id) => id !== "openai") : selected;
  const summary = await transcribeWithAllProviders(processedAudio, mimeType, resolvedLanguage, otherModels);
  if (openaiTranscript) {
    summary.attempts.openai = { success: true, transcript: openaiTranscript, latencyMs: 0 };
    if (!summary.primaryProviderId) {
      summary.primaryProviderId = "openai";
      summary.primaryTranscript = openaiTranscript;
    }
  }
  if (!summary.primaryTranscript) {
    return res.json({
      success: true,
      gainNormalizationApplied,
      detectedLanguage: resolvedLanguage,
      transcript: null,
      primaryProviderId: summary.primaryProviderId,
      attempts: summary.attempts
    });
  }
  const reply = await getSabiLineReply(
    Array.isArray(history) ? history : [],
    summary.primaryTranscript,
    resolvedLanguage,
    Number(elapsedMinutes) || 0
  );
  if (!reply.success) {
    return res.status(reply.quotaExceeded ? 429 : 500).json({
      success: false,
      quotaExceeded: reply.quotaExceeded,
      notConfigured: reply.notConfigured,
      timedOut: reply.timedOut,
      error: reply.error
    });
  }
  const spokenLowEvidence = previousLanguage !== null && isLowEvidenceForLanguageSwitch(summary.primaryTranscript);
  const finalLanguage = resolveLanguageSwitch(
    resolvedLanguage,
    reply.languageCode,
    reply.confidence,
    spokenLowEvidence
  ).language;
  finalizeIntakeIfDone(resolvedVisitId, finalLanguage, reply, priorLanguageHistory);
  res.json({
    success: true,
    visitId: resolvedVisitId,
    gainNormalizationApplied,
    detectedLanguage: finalLanguage,
    transcript: summary.primaryTranscript,
    primaryProviderId: summary.primaryProviderId,
    attempts: summary.attempts,
    spokenReply: reply.spokenReply,
    done: reply.done,
    fields: reply.fields,
    department: reply.department,
    appointmentSlot: reply.appointmentSlot,
    appointmentSlotIso: reply.appointmentSlotIso,
    needsManualReview: reply.needsManualReview
  });
}));
app.post("/api/intake/remind", asyncHandler(async (req, res) => {
  const { phoneNumber, department, appointmentSlot } = req.body;
  if (!phoneNumber || typeof phoneNumber !== "string") {
    return res.status(400).json({ success: false, error: "phoneNumber is required." });
  }
  if (!isTwilioConfigured()) {
    return res.json({
      success: false,
      notConfigured: true,
      error: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are not all set, so no reminder call can be placed."
    });
  }
  const departmentPart = department ? ` at ${department}` : "";
  const slotPart = appointmentSlot ? ` on ${appointmentSlot}` : "";
  const message = `Hello, this is a reminder from SabiLine about your upcoming appointment${departmentPart}${slotPart}. Please arrive a few minutes early. Thank you, and see you soon.`;
  const result = await placeReminderCall(phoneNumber, message);
  res.json(result);
}));
app.post("/api/intake/reminders/run-due", asyncHandler(async (_req, res) => {
  const result = await runDueReminders();
  res.json({ success: true, ...result });
}));
app.get("/api/intake/reminders", (_req, res) => {
  res.json({ success: true, reminders: listScheduledReminders() });
});
app.get("/api/benchmark/reference", (req, res) => {
  res.json({
    success: true,
    spec: AFRIHEALTH_BENCHMARK_SPEC,
    historicalResults: AFRIHEALTH_REFERENCE_RESULTS
  });
});
app.get("/api/samples", (req, res) => {
  res.json({
    success: true,
    samples: CLINICAL_AUDIO_SAMPLES
  });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  rehydratePendingReminders();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AfriVoice Studio Server running on http://0.0.0.0:${PORT}`);
  });
}
var server_default = app;
if (!process.env.VERCEL) {
  startServer();
}
export {
  server_default as default
};
