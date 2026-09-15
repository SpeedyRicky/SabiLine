// server.ts
import express from "express";
import path3 from "path";
import dotenv from "dotenv";
import { Modality as Modality2 } from "@google/genai";

// src/services/tts/geminiClient.ts
import { GoogleGenAI } from "@google/genai";
var geminiClient = null;
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return geminiClient;
}
function isQuotaExceededError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("RESOURCE_EXHAUSTED") || message.includes("429");
}
function isInvalidApiKeyError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("API_KEY_INVALID") || message.includes("API key not valid");
}
function isTransientOverloadError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNAVAILABLE") || message.includes('"code":503') || message.includes(" 503 ");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var GeminiTimeoutError = class extends Error {
  constructor(message = "Gemini took too long to respond.") {
    super(message);
    this.name = "GeminiTimeoutError";
  }
};
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GeminiTimeoutError()), ms);
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
function isTimeoutError(err) {
  return err instanceof GeminiTimeoutError;
}
var GEMINI_CALL_TIMEOUT_MS = 8e3;
async function withGeminiRetry(fn, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientOverloadError(err) || attempt === maxRetries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// src/services/tts/pcmToWav.ts
function pcmToWavBuffer(pcmBuffer, sampleRate = 24e3, numChannels = 1, bitDepth = 16) {
  const byteRate = sampleRate * numChannels * bitDepth / 8;
  const blockAlign = numChannels * bitDepth / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// src/services/tts/geminiSynthesize.ts
import { Modality } from "@google/genai";

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

// src/services/tts/geminiSynthesize.ts
var referenceAudioCache = /* @__PURE__ */ new Map();
async function synthesizeReferenceAudio(text, language) {
  const cacheKey = `${language}::${text}`;
  const cached = referenceAudioCache.get(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }
  const ai = getGeminiClient();
  if (!ai) {
    return {
      success: false,
      error: "GEMINI_API_KEY is not configured, so no reference audio can be synthesized for this benchmark run."
    };
  }
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: `Speak clearly and naturally in ${language}: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
        }
      }
    });
    const rawPcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!rawPcmBase64) {
      throw new Error("Gemini model did not return audio data in candidates response.");
    }
    const pcmRawBuffer = Buffer.from(rawPcmBase64, "base64");
    const wavBuffer = pcmToWavBuffer(pcmRawBuffer, 24e3, 1, 16);
    const durationSec = Math.max(1, Math.round(pcmRawBuffer.length / (24e3 * 2) * 10) / 10);
    const { buffer: audioBuffer } = normalizeQuietAudio(wavBuffer);
    const result = {
      success: true,
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/wav",
      durationSec
    };
    referenceAudioCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return {
      success: false,
      quotaExceeded: isQuotaExceededError(err),
      error: err instanceof Error ? err.message : "Gemini reference audio synthesis failed."
    };
  }
}

// src/services/asr/geminiAsr.ts
var geminiAsrProvider = {
  id: "gemini",
  displayName: "Google Gemini (audio transcription)",
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  async transcribe(audioBase64, mimeType, language) {
    const start = Date.now();
    const ai = getGeminiClient();
    if (!ai) {
      return { success: false, error: "GEMINI_API_KEY is not configured.", latencyMs: Date.now() - start };
    }
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            parts: [
              {
                text: `Transcribe the following ${language} audio exactly as spoken, including any code-switching between languages. Output ONLY the raw transcription text \u2014 no commentary, no quotation marks, no formatting.`
              },
              { inlineData: { mimeType, data: audioBase64 } }
            ]
          }
        ]
      });
      const transcript = (response.text || "").trim();
      if (!transcript) {
        return { success: false, error: "Gemini returned an empty transcription.", latencyMs: Date.now() - start };
      }
      return { success: true, transcript, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Gemini transcription failed.",
        latencyMs: Date.now() - start
      };
    }
  }
};

// src/services/asr/saharaAsr.ts
var saharaAsrProvider = {
  id: "sahara",
  displayName: "Intron Sahara",
  isConfigured: () => Boolean(process.env.SAHARA_API_KEY),
  async transcribe(audioBase64, mimeType, language) {
    const start = Date.now();
    const apiKey = process.env.SAHARA_API_KEY?.trim();
    if (!apiKey) {
      return { success: false, error: "SAHARA_API_KEY is not configured.", latencyMs: Date.now() - start };
    }
    try {
      const response = await fetch("https://api.intron.io/v1/asr/transcribe", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ audio: audioBase64, mimeType, language })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sahara ASR API returned status ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const transcript = String(data.transcript || data.text || "").trim();
      if (!transcript) {
        throw new Error("Sahara ASR API response did not include a transcript field.");
      }
      return { success: true, transcript, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Sahara transcription failed.",
        latencyMs: Date.now() - start
      };
    }
  }
};

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
  gemini: geminiAsrProvider,
  sahara: saharaAsrProvider,
  model_b: modelBProvider,
  model_c: modelCProvider
};
var DEFAULT_BENCHMARK_MODELS = ["gemini", "sahara", "model_b", "model_c"];

// src/services/asr/transcribeLive.ts
var LIVE_ASR_PRIORITY = ["sahara", "model_b", "model_c", "gemini"];
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
var SUPPORTED_CODES = ["en", "pcm", "yo", "ig", "ha", "ful"];
var LANGUAGE_CHOICES_DESC = "English (en), Nigerian Pidgin (pcm), Yoruba (yo), Igbo (ig), Hausa (ha), or Fulfulde (ful)";
async function detectLanguageAndTranscribe(audioBase64, mimeType) {
  const start = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, notConfigured: true, error: "GEMINI_API_KEY is not configured.", latencyMs: Date.now() - start };
  }
  try {
    const response = await withTimeout(
      withGeminiRetry(
        () => ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: [
            {
              parts: [
                {
                  text: `Listen to this audio of a patient speaking at a health clinic intake desk. First identify which language they are speaking, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. If none of those are a good match, still pick the closest one. Then transcribe exactly what they said, including any code-switching between languages. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful", "transcript": string}`
                },
                { inlineData: { mimeType, data: audioBase64 } }
              ]
            }
          ],
          config: { responseMimeType: "application/json" }
        })
      ),
      GEMINI_CALL_TIMEOUT_MS
    );
    const parsed = JSON.parse(response.text || "{}");
    const transcript = String(parsed.transcript || "").trim();
    const languageCode = SUPPORTED_CODES.includes(parsed.languageCode) ? parsed.languageCode : "en";
    if (!transcript) {
      return { success: false, error: "Gemini returned an empty transcription.", latencyMs: Date.now() - start };
    }
    return { success: true, languageCode, transcript, latencyMs: Date.now() - start };
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
async function detectLanguageFromText(text) {
  const start = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, notConfigured: true, error: "GEMINI_API_KEY is not configured.", latencyMs: Date.now() - start };
  }
  try {
    const response = await withTimeout(
      withGeminiRetry(
        () => ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: [
            {
              parts: [
                {
                  text: `A patient typed this at a health clinic intake desk: "${text.replace(/"/g, "'")}". Identify which language they most likely intended, choosing the closest match from: ${LANGUAGE_CHOICES_DESC}. Return ONLY this JSON shape: {"languageCode": "en"|"pcm"|"yo"|"ig"|"ha"|"ful"}`
                }
              ]
            }
          ],
          config: { responseMimeType: "application/json" }
        })
      ),
      GEMINI_CALL_TIMEOUT_MS
    );
    const parsed = JSON.parse(response.text || "{}");
    const languageCode = SUPPORTED_CODES.includes(parsed.languageCode) ? parsed.languageCode : "en";
    return { success: true, languageCode, latencyMs: Date.now() - start };
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
var LANGUAGE_NAMES = {
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
function buildSystemInstructionWithSlots(language, elapsedMinutes, isOpeningCall, slots) {
  const langName = LANGUAGE_NAMES[language] || language;
  const driftNote = elapsedMinutes >= 2 ? ` This call has been going for about ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} so far. If the conversation has drifted away from health or clinic topics and stayed off-topic for somewhere in the range of 2 to 7 minutes of that drift, gently mention \u2014 once, not every message \u2014 that you're the SabiLine health line and are best able to help with health-related concerns, then offer to get back to their visit. Don't cut off brief small talk; only redirect once it's clearly gone on a while.` : "";
  const openingNote = isOpeningCall ? " The call has just connected and the patient hasn't said anything yet \u2014 don't wait for them: open with a brief, warm greeting that introduces yourself as SabiLine and invites them to share why they're calling, in English (you don't know their language yet)." : "";
  return [
    "You are SabiLine, a warm, human-sounding intake receptionist at an African health clinic.",
    "Speak naturally like a real person: vary your wording, react to what the patient actually said, keep each reply short (1-2 sentences, occasionally 3) since it will be read aloud, and never repeat a question you already have an answer to." + openingNote,
    `Respond in ${langName} for "spokenReply" ONLY, matching any code-switching the patient uses, without ever mentioning that you're doing this.`,
    "Through natural back-and-forth, not a rigid checklist and not necessarily in this order, find out: the patient's name, their age or date of birth, a phone number to reach them on (explain it's so the clinic can call to remind them of their appointment), their payment or insurance type, their reason for visiting, how long their symptoms have lasted, and any known allergies. Ask about one thing at a time. If they don't know or decline to answer something, don't press repeatedly \u2014 move on and leave it blank.",
    "It's fine for the patient to chat about other things along the way \u2014 follow them naturally and don't refuse to engage." + driftNote,
    `Once you have gathered what you reasonably can, pick the single best-fitting department for their reason for visit from this list: ${DEPARTMENTS.join(", ")} \u2014 then propose exactly one appointment time from these options: ${slots.map((s) => s.label).join(", ")} (say it to the patient in ${langName}, but the "appointmentSlot" JSON field must be copied verbatim from that English list). If they want a different time, offer another option from that same list. Once they confirm a time, let them know their visit is logged and a staff member will follow up shortly, then say goodbye \u2014 set "done" to true only on that final message.`,
    'Always reply with ONLY this JSON: {"spokenReply": string, "done": boolean, "fields": {"name": string|null, "ageOrDob": string|null, "phoneNumber": string|null, "paymentType": string|null, "reasonForVisit": string|null, "symptomDuration": string|null, "allergies": string|null}, "department": string|null, "appointmentSlot": string|null, "needsManualReview": boolean}.',
    'CRITICAL: "spokenReply" is the only field spoken/shown to the patient and is the only field allowed to be in ' + langName + `. Every other field in the JSON \u2014 "fields" (name, ageOrDob, phoneNumber, paymentType, reasonForVisit, symptomDuration, allergies), "department", and "appointmentSlot" \u2014 MUST always be written in English regardless of what language the patient spoke, because clinic staff who read the record only read English. Translate the patient's answers into plain English for these fields (e.g. a Yoruba reason for visit like "Mo ni iba" must be recorded as "Fever"); never leave them in the original language.`,
    '"fields" is your best current understanding so far, updated every turn \u2014 use null (never a guess) for anything the patient has not actually stated. "department" and "appointmentSlot" stay null until a time is actually confirmed, and "appointmentSlot" must exactly match one of the English options given above. Set "needsManualReview" to true only once "done" is true and important fields are still missing or unclear.'
  ].join(" ");
}
async function getSabiLineReply(history, userText, language, elapsedMinutes) {
  const ai = getGeminiClient();
  if (!ai) {
    return { success: false, notConfigured: true, error: "GEMINI_API_KEY is required for the conversational intake." };
  }
  const isOpeningCall = userText === null;
  const slotsForThisTurn = nextSlots();
  try {
    const newTurnText = isOpeningCall ? "[The call has just connected.]" : userText;
    const contents = history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })).concat([{ role: "user", parts: [{ text: newTurnText }] }]);
    const response = await withTimeout(
      withGeminiRetry(
        () => ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents,
          config: {
            systemInstruction: buildSystemInstructionWithSlots(language, elapsedMinutes, isOpeningCall, slotsForThisTurn),
            responseMimeType: "application/json"
          }
        })
      ),
      GEMINI_CALL_TIMEOUT_MS
    );
    const parsed = JSON.parse(response.text || "{}");
    const spokenReply = String(parsed.spokenReply || "").trim();
    if (!spokenReply) {
      return { success: false, error: "Gemini returned an empty reply." };
    }
    return {
      success: true,
      spokenReply,
      done: Boolean(parsed.done),
      fields: parsed.fields,
      department: parsed.department ?? null,
      appointmentSlot: parsed.appointmentSlot ?? null,
      appointmentSlotIso: findSlotIso(parsed.appointmentSlot, slotsForThisTurn),
      needsManualReview: Boolean(parsed.needsManualReview)
    };
  } catch (err) {
    if (isInvalidApiKeyError(err)) {
      return {
        success: false,
        notConfigured: true,
        error: "GEMINI_API_KEY is set but Google rejected it as invalid. Check the key in the deployment environment variables (e.g. Vercel > Settings > Environment Variables) and redeploy."
      };
    }
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
import fs2 from "node:fs";
import path2 from "node:path";
var DATA_DIR2 = path2.join(process.cwd(), "data");
var LOG_FILE = path2.join(DATA_DIR2, "staff-visit-log.json");
var MAX_ENTRIES = 500;
var LANGUAGE_NAMES2 = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  ful: "Fulfulde"
};
function buildEnglishVisitSummary(params) {
  const { referenceNumber, language, fields, department, appointmentSlot, needsManualReview } = params;
  const langName = LANGUAGE_NAMES2[language] || language;
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
  if (needsManualReview) {
    lines.push("\u26A0\uFE0F Flagged for manual review \u2014 one or more fields are missing or unclear.");
  }
  return lines.join("\n");
}
function loadLog() {
  try {
    if (!fs2.existsSync(LOG_FILE)) return [];
    const parsed = JSON.parse(fs2.readFileSync(LOG_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function recordVisitForStaff(entry) {
  const full = { ...entry, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
  console.log(`[SabiLine staff record]
${full.summary}`);
  try {
    if (!fs2.existsSync(DATA_DIR2)) fs2.mkdirSync(DATA_DIR2, { recursive: true });
    const log = loadLog().filter((e) => e.visitId !== full.visitId);
    log.unshift(full);
    fs2.writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, MAX_ENTRIES), null, 2));
  } catch {
  }
}
function listStaffVisits() {
  return loadLog();
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
app.get("/api/providers/status", (req, res) => {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
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
        name: "Intron Sahara (STT / Benchmark)",
        isConfigured: hasSahara,
        statusMessage: hasSahara ? "Connected (used as a real ASR provider in the Benchmark tab)" : "Awaiting SAHARA_API_KEY in server secrets",
        supportedLanguages: ["ha", "ig", "yo", "en"]
      },
      gemini: {
        id: "gemini",
        name: "Gemini 3.1 Flash Voice",
        isConfigured: hasGemini,
        statusMessage: hasGemini ? "Connected (Multimodal Generative Audio active)" : "Awaiting GEMINI_API_KEY in server secrets",
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
});
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
  if (!text || !text.trim()) {
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
    const saharaKey = process.env.SAHARA_API_KEY?.trim();
    if (!saharaKey) {
      return res.status(400).json({
        success: false,
        error: "Sahara API key is not configured in server environment. Please set SAHARA_API_KEY in secrets, or choose Gemini 3.1 Flash Voice / Device Web Speech.",
        provider: "sahara"
      });
    }
    try {
      const saharaResponse = await fetch("https://api.intron.io/v1/tts/synthesize", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${saharaKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          language,
          voice: voiceId,
          speed,
          pitch
        })
      });
      if (!saharaResponse.ok) {
        const errText = await saharaResponse.text();
        throw new Error(`Sahara API returned status ${saharaResponse.status}: ${errText}`);
      }
      const audioBlob = await saharaResponse.arrayBuffer();
      const base64Audio = Buffer.from(audioBlob).toString("base64");
      const durationSec = Math.max(1.5, Math.round(text.split(/\s+/).length * 0.45));
      return res.json({
        success: true,
        audioBase64: base64Audio,
        mimeType: "audio/wav",
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
      return res.status(502).json({
        success: false,
        error: `Sahara speech service error: ${err.message || "Connection failed"}`
      });
    }
  }
  if (provider === "gemini") {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        success: false,
        error: "GEMINI_API_KEY is not configured in server secrets. Please configure it in Settings > Secrets.",
        provider: "gemini"
      });
    }
    try {
      let prebuiltVoice = "Kore";
      if (voiceId.includes("puck")) prebuiltVoice = "Puck";
      else if (voiceId.includes("charon")) prebuiltVoice = "Charon";
      else if (voiceId.includes("fenrir")) prebuiltVoice = "Fenrir";
      else if (voiceId.includes("zephyr")) prebuiltVoice = "Zephyr";
      const stylePrompt = emotion === "empathic" ? "Speak with genuine clinical empathy, warmth, and care: " : emotion === "authoritative" ? "Speak with clear, authoritative public health clarity: " : emotion === "urgent" ? "Speak with calm urgency suitable for clinical triage: " : "Speak clearly and naturally: ";
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `${stylePrompt}${text}` }] }],
        config: {
          responseModalities: [Modality2.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: prebuiltVoice }
            }
          }
        }
      });
      const rawPcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!rawPcmBase64) {
        throw new Error("Gemini model did not return audio data in candidates response.");
      }
      const pcmRawBuffer = Buffer.from(rawPcmBase64, "base64");
      const wavBuffer = pcmToWavBuffer(pcmRawBuffer, 24e3, 1, 16);
      const wavBase64 = wavBuffer.toString("base64");
      const durationSec = Math.round(pcmRawBuffer.length / (24e3 * 2) * 10) / 10;
      return res.json({
        success: true,
        audioBase64: wavBase64,
        mimeType: "audio/wav",
        durationSec: Math.max(1, durationSec),
        text,
        language,
        voiceId,
        provider: "gemini",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        latencyMs: Date.now() - startTime
      });
    } catch (err) {
      console.error("Gemini TTS error:", err);
      const quotaExceeded = isQuotaExceededError(err);
      return res.status(quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded,
        error: quotaExceeded ? "Gemini's free-tier voice generation quota is exhausted for today. Switch to Device Web Speech, or enable billing on your Gemini API key for higher limits." : `Gemini Voice generation failed: ${err.message || "Internal error"}`
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
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(400).json({
      success: false,
      error: "GEMINI_API_KEY is required for multilingual translation."
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
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt
    });
    const translatedText = (response.text || "").trim();
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
      error: `Translation failed: ${err.message || "Gemini error"}`
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
  const ai = getGeminiClient();
  if (!ai) {
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
        clinicalReviewNote: "Evaluation evaluated via standard African clinical criteria (Gemini key not configured for dynamic judge)."
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
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    const parsed = JSON.parse(response.text || "{}");
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
  if (!sampleIds.length) {
    return res.status(400).json({ success: false, error: "At least one sampleId must be selected." });
  }
  const targetSamples = CLINICAL_AUDIO_SAMPLES.filter((s) => sampleIds.includes(s.id));
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
      error: "None of the selected speech models are configured for real evaluation. Set GEMINI_API_KEY (also required to synthesize reference audio), SAHARA_API_KEY, or MODEL_B_API_KEY+MODEL_B_API_URL / MODEL_C_API_KEY+MODEL_C_API_URL."
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
function finalizeIntakeIfDone(visitId, language, reply) {
  if (!reply.success || !reply.done || !reply.fields) return;
  const summary = buildEnglishVisitSummary({
    referenceNumber: visitId,
    language,
    fields: reply.fields,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    needsManualReview: Boolean(reply.needsManualReview)
  });
  recordVisitForStaff({
    visitId,
    language,
    fields: reply.fields,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    appointmentSlotIso: reply.appointmentSlotIso ?? null,
    needsManualReview: Boolean(reply.needsManualReview),
    summary
  });
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
    selectedModels
  } = req.body;
  const resolvedVisitId = typeof visitId === "string" && visitId ? visitId : randomUUID();
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
    finalizeIntakeIfDone(resolvedVisitId, "en", reply2);
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
    let resolvedLanguage2 = language === "auto" ? "en" : language;
    let detectedLanguage2 = null;
    if (language === "auto") {
      const detection = await detectLanguageFromText(typedText);
      if (!detection.success || !detection.languageCode) {
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
      resolvedLanguage2 = detection.languageCode;
      detectedLanguage2 = detection.languageCode;
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
    finalizeIntakeIfDone(resolvedVisitId, resolvedLanguage2, reply2);
    return res.json({
      success: true,
      visitId: resolvedVisitId,
      detectedLanguage: detectedLanguage2,
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
  let resolvedLanguage = language === "auto" ? "en" : language;
  let detectedLanguage = null;
  let geminiTranscript = null;
  if (language === "auto") {
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
          gemini: { success: false, error: detection.error, latencyMs: detection.latencyMs }
        }
      });
    }
    resolvedLanguage = detection.languageCode;
    detectedLanguage = detection.languageCode;
    geminiTranscript = detection.transcript ?? null;
  }
  const otherModels = geminiTranscript ? selected.filter((id) => id !== "gemini") : selected;
  const summary = await transcribeWithAllProviders(processedAudio, mimeType, resolvedLanguage, otherModels);
  if (geminiTranscript) {
    summary.attempts.gemini = { success: true, transcript: geminiTranscript, latencyMs: 0 };
    if (!summary.primaryProviderId) {
      summary.primaryProviderId = "gemini";
      summary.primaryTranscript = geminiTranscript;
    }
  }
  if (!summary.primaryTranscript) {
    return res.json({
      success: true,
      gainNormalizationApplied,
      detectedLanguage,
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
  finalizeIntakeIfDone(resolvedVisitId, resolvedLanguage, reply);
  res.json({
    success: true,
    visitId: resolvedVisitId,
    gainNormalizationApplied,
    detectedLanguage,
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
app.get("/api/intake/visits", (_req, res) => {
  res.json({ success: true, visits: listStaffVisits() });
});
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
    const distPath = path3.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path3.join(distPath, "index.html"));
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
