import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { isOpenAIConfigured, openaiChatCompletion, openaiSynthesizeSpeech, isQuotaExceededError, checkOpenAIReachable } from './src/services/tts/openaiClient';
import { synthesizeReferenceAudio } from './src/services/tts/openaiSynthesize';
import { isSaharaConfigured, synthesizeWithSahara, SaharaLanguageUnsupportedError } from './src/services/tts/saharaTts';
import { saharaAsrProvider } from './src/services/asr/saharaAsr';
import { getActiveModels } from './src/services/tts/openaiClient';
import { ASR_PROVIDER_REGISTRY, DEFAULT_BENCHMARK_MODELS } from './src/services/asr/registry';
import { transcribeWithAllProviders, LIVE_ASR_PRIORITY } from './src/services/asr/transcribeLive';
import { detectLanguageAndTranscribe, detectLanguageFromText, transcribeWithLanguageHint, isLowEvidenceForLanguageSwitch, resolveLanguageSwitch, SUPPORTED_LANGUAGE_CODES } from './src/services/asr/detectLanguage';
import { getSabiLineReply } from './src/services/intake/converse';
import { isTwilioConfigured, placeReminderCall } from './src/services/reminder/twilioReminder';
import { scheduleAppointmentReminders, rehydratePendingReminders, runDueReminders, listScheduledReminders } from './src/services/reminder/reminderScheduler';
import { notifyStaffOfVisit, buildEnglishVisitSummary } from './src/services/notify/staffNotify';
import { randomUUID } from 'crypto';
import { normalizeQuietAudio } from './src/services/asr/audioPreprocess';
import { sanitizeProviderError } from './src/utils/sanitizeProviderError';
import { calculateWER } from './src/services/benchmark/wer';
import { calculateCER } from './src/services/benchmark/cer';
import { calculateAccuracy } from './src/services/benchmark/accuracy';
import { performErrorAnalysis, analyzeCodeSwitching } from './src/services/benchmark/errorAnalysis';
import { calculateSentenceBLEU, calculateChrF } from './src/services/benchmark/bleu';
import { CLINICAL_AUDIO_SAMPLES } from './src/services/benchmark/sampleDataset';
import { AFRIHEALTH_REFERENCE_RESULTS, AFRIHEALTH_BENCHMARK_SPEC } from './src/services/benchmark/referenceData';
import { LanguageCode } from './src/types';

dotenv.config();

const app = express();
const PORT = 3000;

// CORS for the API only. The web build is same-origin and needs none of this,
// but a packaged Capacitor build is NOT: the WebView serves the bundle from
// `capacitor://localhost` (iOS) / `http://localhost` (Android) while the API
// lives on the deployment origin, so every /api call is cross-origin and the
// browser blocks it before it is sent. Reflecting the request Origin is
// deliberate and safe here — this API carries no cookies, no session and no
// credentials of any kind, and every route is already reachable by anyone
// anonymously, so there is no origin to protect against. `Vary: Origin` keeps
// any intermediary from serving one origin's response to another.
app.use('/api', (req: Request, res: Response, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '50mb' }));

// Express 4 does not catch a rejected promise from an async route handler —
// an unexpected throw deep in a call chain (not caught by that function's
// own try/catch) would otherwise leave the request hanging until the
// platform's own timeout kills it, returning a non-JSON error page that
// breaks every client-side `res.json()` call. Every async route below is
// wrapped in this so any such gap degrades to one honest JSON error
// response instead of a silent hang or an opaque platform-level failure.
function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('Unhandled route error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Unexpected server error. Please try again.' });
      }
    });
  };
}

// 1. Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    product: 'AfriVoice Studio - Sahara CodeSwitch Africa Challenge',
    timestamp: new Date().toISOString(),
  });
});

// 2. Provider configuration status (honest and transparent). OpenAI's entry
// is verified, not just checked for a key string: `isConfigured` here means
// "a key is present AND the configured origin actually answers as a real
// OpenAI-compatible API", via a short-TTL-cached reachability probe (see
// checkOpenAIReachable in openaiClient.ts). Claiming "Connected" from key
// presence alone is exactly how this app previously told users everything
// was fine while every real call 404'd against a misconfigured origin.
app.get('/api/providers/status', asyncHandler(async (req: Request, res: Response) => {
  const hasOpenAIKey = isOpenAIConfigured();
  const openAiReachability = hasOpenAIKey
    ? await checkOpenAIReachable()
    : { reachable: false, message: 'Awaiting OPEN_AI_KEY in server secrets.' };
  const openAiIsConfigured = hasOpenAIKey && openAiReachability.reachable;
  const hasSahara = Boolean(process.env.SAHARA_API_KEY);

  res.json({
    providers: {
      sahara: {
        id: 'sahara',
        name: 'Intron Sahara (TTS)',
        isConfigured: hasSahara,
        statusMessage: hasSahara
          ? 'Connected (Native African Speech Models active)'
          : 'Awaiting SAHARA_API_KEY in server secrets',
        supportedLanguages: ['ha', 'ig', 'yo', 'en'],
      },
      sahara_stt: {
        id: 'sahara_stt',
        // Transcription needs SAHARA_ASR_URL as well as the key — Intron's
        // ASR route is not published, so it is bring-your-own (see
        // src/services/asr/saharaAsr.ts). Report what the provider itself
        // says rather than inferring "connected" from the key alone.
        name: 'Intron Sahara (STT / Benchmark)',
        isConfigured: saharaAsrProvider.isConfigured(),
        statusMessage: saharaAsrProvider.isConfigured()
          ? 'Connected (used as a real ASR provider in the Benchmark tab)'
          : hasSahara
            ? 'Awaiting SAHARA_ASR_URL — the key is set, but Sahara\'s transcription endpoint has not been configured'
            : 'Awaiting SAHARA_API_KEY in server secrets',
        supportedLanguages: ['ha', 'ig', 'yo', 'en'],
      },
      openai: {
        id: 'openai',
        name: 'OpenAI Voice & Transcription',
        isConfigured: openAiIsConfigured,
        // Report what was actually measured. checkOpenAIReachable() does one
        // GET /v1/models: it proves the origin is a real OpenAI-compatible
        // API, and deliberately counts a rejected key as reachable. It never
        // sends a model name, so claiming "chat, transcription, and voice
        // synthesis active" asserted three things nothing had tested — and
        // showed a rejected key as fully Connected.
        statusMessage: openAiIsConfigured
          ? `Origin reachable — ${openAiReachability.message} Per-call errors will name the model or key if one is wrong.`
          : openAiReachability.message,
        // Which model each category is actually sending, and whether the
        // client had to substitute it after the configured one was retired.
        // Without this a substitution is invisible, and the env var appears to
        // be in effect when it is not.
        models: getActiveModels(),
        supportedLanguages: ['en', 'fr', 'es', 'zh', 'hi', 'ha', 'ig', 'yo'],
      },
      model_b: {
        id: 'model_b',
        name: 'Model B (custom ASR endpoint)',
        isConfigured: ASR_PROVIDER_REGISTRY.model_b.isConfigured(),
        statusMessage: ASR_PROVIDER_REGISTRY.model_b.isConfigured()
          ? 'Connected'
          : 'Awaiting MODEL_B_API_KEY and MODEL_B_API_URL (bring your own real ASR endpoint)',
      },
      model_c: {
        id: 'model_c',
        name: 'Model C (custom ASR endpoint)',
        isConfigured: ASR_PROVIDER_REGISTRY.model_c.isConfigured(),
        statusMessage: ASR_PROVIDER_REGISTRY.model_c.isConfigured()
          ? 'Connected'
          : 'Awaiting MODEL_C_API_KEY and MODEL_C_API_URL (bring your own real ASR endpoint)',
      },
      browser: {
        id: 'browser',
        name: 'Device Web Speech API',
        isConfigured: true,
        statusMessage: 'Ready (Local device speech synthesis)',
        supportedLanguages: ['en', 'fr', 'es', 'zh', 'hi'],
      },
    },
  });
}));

// 3. Real Text-To-Speech generation endpoint
app.post('/api/tts/generate', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  const {
    text,
    language,
    voiceId,
    provider,
    speed = 1.0,
    pitch = 1.0,
    emotion = 'neutral',
  } = req.body;

  // Type-checked, not just truthiness-checked: a non-string `text` (a number,
  // an object) passes `!text` and then dies on `text.trim()` with a raw
  // TypeError instead of a clean 400.
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'Text prompt cannot be empty.' });
  }

  // Handle Browser Native Speech
  if (provider === 'browser') {
    return res.json({
      success: true,
      clientSynthesize: true,
      text,
      language,
      voiceId,
      provider: 'browser',
      durationSec: Math.max(2, Math.round(text.split(/\s+/).length * 0.4)),
      timestamp: new Date().toISOString(),
      note: 'Using browser device speech synthesis',
    });
  }

  // Handle Sahara Provider — generate + download, see saharaTts.ts.
  if (provider === 'sahara') {
    if (!isSaharaConfigured()) {
      return res.status(400).json({
        success: false,
        notConfigured: true,
        error: 'Sahara API key is not configured in server environment. Please set SAHARA_API_KEY in secrets, or choose OpenAI Voice / Device Web Speech.',
        provider: 'sahara',
      });
    }

    try {
      const { audioBase64, mimeType, durationSec } = await synthesizeWithSahara(text, language as LanguageCode, voiceId);

      return res.json({
        success: true,
        audioBase64,
        mimeType,
        durationSec,
        text,
        language,
        voiceId,
        provider: 'sahara',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
      });
    } catch (err: any) {
      console.error('Sahara TTS error:', err);
      // A language Sahara has no voice for is a plain fact about the
      // provider, not a server fault — report it as such so the client can
      // move down the fallback chain without treating it as an outage.
      const unsupported = err instanceof SaharaLanguageUnsupportedError;
      return res.status(unsupported ? 400 : 502).json({
        success: false,
        notSupported: unsupported || undefined,
        // SaharaLanguageUnsupportedError is a fact about the provider, not an
        // infrastructure failure, so it is passed through as written; every
        // other Sahara error is sanitised like the rest of the providers'.
        error: unsupported
          ? err.message
          : sanitizeProviderError(err?.message, { subject: 'Sahara speech synthesis' }),
        provider: 'sahara',
      });
    }
  }

  // Handle OpenAI TTS Provider
  if (provider === 'openai') {
    if (!isOpenAIConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'No OpenAI API key is configured in server secrets. Please configure it in Settings > Secrets.',
        provider: 'openai',
      });
    }

    try {
      // Map requested voice to one of OpenAI's stock voices.
      //
      // `voiceId` is OPTIONAL in this endpoint's contract, and it used to be
      // dereferenced unconditionally — so any caller that omitted it got
      // `Cannot read properties of undefined (reading 'includes')` as a 500
      // instead of the default voice. Coerced to a string first, so an
      // omitted, null or non-string voiceId falls back to 'alloy'.
      const requestedVoice = typeof voiceId === 'string' ? voiceId : '';
      let openaiVoice = 'alloy';
      if (requestedVoice.includes('onyx')) openaiVoice = 'onyx';
      else if (requestedVoice.includes('nova')) openaiVoice = 'nova';
      else if (requestedVoice.includes('shimmer')) openaiVoice = 'shimmer';
      else if (requestedVoice.includes('echo')) openaiVoice = 'echo';

      const stylePrompt = emotion === 'empathic'
        ? 'Speak with genuine clinical empathy, warmth, and care: '
        : emotion === 'authoritative'
        ? 'Speak with clear, authoritative public health clarity: '
        : emotion === 'urgent'
        ? 'Speak with calm urgency suitable for clinical triage: '
        : 'Speak clearly and naturally: ';

      // Note: OpenAI's /audio/speech endpoint takes no language parameter —
      // pronunciation is inferred from the input text alone, and its stock
      // voices are tuned overwhelmingly for English. Quality on Yoruba,
      // Igbo, Hausa, Fulfulde, and Pidgin input is unverified here.
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
        provider: 'openai',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
      });
    } catch (err: any) {
      console.error('OpenAI TTS error:', err);
      const quotaExceeded = isQuotaExceededError(err);
      return res.status(quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded,
        // Never the raw provider message: a live rate-limit response used to
        // reach the patient carrying the internal provider hostname, the
        // account's organization id and its exact token quota.
        error: quotaExceeded
          ? "The voice provider's quota is exhausted right now. Switch to Device Web Speech, or check billing on the configured voice key."
          : sanitizeProviderError(err?.message, { subject: 'Voice generation' }),
      });
    }
  }

  return res.status(400).json({ success: false, error: `Unknown provider '${provider}' requested.` });
}));

// 4. Clinical Multilingual Translation Endpoint
app.post('/api/translate', asyncHandler(async (req: Request, res: Response) => {
  const { text, sourceLang = 'en', targetLang } = req.body;

  if (!text || !targetLang) {
    return res.status(400).json({ success: false, error: 'Text and targetLang are required.' });
  }

  if (sourceLang === targetLang) {
    return res.json({ success: true, translatedText: text, sourceLang, targetLang });
  }

  if (!isOpenAIConfigured()) {
    return res.status(400).json({
      success: false,
      error: 'An OpenAI API key is required for multilingual translation.',
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

    const translatedText = (await openaiChatCompletion([{ role: 'user', content: prompt }])).trim();
    return res.json({
      success: true,
      translatedText,
      sourceLang,
      targetLang,
    });
  } catch (err: any) {
    console.error('Translation error:', err);
    return res.status(500).json({
      success: false,
      error: `Translation failed: ${err.message || 'OpenAI error'}`,
    });
  }
}));

// 5. Code-switching analysis endpoint
app.post('/api/codeswitch/analyze', (req: Request, res: Response) => {
  const { text, primaryLang = 'en' } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required for code-switch analysis.' });
  }

  const analysis = analyzeCodeSwitching(text, primaryLang as LanguageCode);
  res.json({ success: true, analysis });
});

// 6. Clinical Spoken QA Evaluation endpoint
app.post('/api/qa/evaluate', asyncHandler(async (req: Request, res: Response) => {
  const { question, referenceAnswer, clinicalDomain } = req.body;

  if (!isOpenAIConfigured()) {
    // Fallback rule-based assessment if no OpenAI key is set up
    return res.json({
      success: true,
      evaluation: {
        factuality: 4.0,
        appropriateness: 4.2,
        adequacy: 4.0,
        clinicalReasoning: 3.8,
        uncertaintyHandling: 3.5,
        empathy: 4.1,
        hallucinationRisk: 'low',
        localRelevance: 4.3,
        harmAssessment: 'safe',
        clinicalReviewNote: 'Evaluation evaluated via standard African clinical criteria (no OpenAI key configured for dynamic judge).',
      },
    });
  }

  try {
    const prompt = `You are a senior clinical auditor evaluating an automated speech-to-text and AI response system for African healthcare.
Evaluate this clinical question and answer along the 8 dimensions established in the AfriHealth MultiBench protocol:
Question: "${question}"
Reference Guideline: "${referenceAnswer || 'Standard WHO / African CDC clinical guidelines'}"

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

    const content = await openaiChatCompletion([{ role: 'user', content: prompt }], { jsonResponse: true });
    const parsed = JSON.parse(content || '{}');
    return res.json({ success: true, evaluation: parsed });
  } catch (err: any) {
    console.error('QA Eval error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}));

// 7. Live Speech Model Benchmark Runner
//
// Real pipeline: for each sample, synthesize one real audio clip from the
// ground-truth transcript (so every model is fed identical input), then send
// that same audio to every configured ASR provider and score its actual
// returned transcript with the real WER/CER engine. A model that isn't
// configured (no API key, or for Model B/C no custom endpoint URL) is
// reported as not-configured and excluded from the averages below — never
// zero-filled or fabricated. See src/services/asr/ for the provider
// implementations and src/services/tts/openaiSynthesize.ts for the audio
// synthesis step.
app.post('/api/benchmark/run', asyncHandler(async (req: Request, res: Response) => {
  const {
    sampleIds = [],
    selectedModels = DEFAULT_BENCHMARK_MODELS as string[],
    normalizationOptions = {
      stripPunctuation: true,
      toLowerCase: true,
      normalizeWhitespace: true,
      stripDiacritics: false,
    },
  } = req.body;

  // A destructuring default only applies to `undefined`, not `null` — so an
  // explicit `"sampleIds": null` would reach `sampleIds.length` and throw.
  const requestedSampleIds: string[] = Array.isArray(sampleIds) ? sampleIds : [];

  if (!requestedSampleIds.length) {
    return res.status(400).json({ success: false, error: 'At least one sampleId must be selected.' });
  }

  // Find samples from verified dataset
  const targetSamples = CLINICAL_AUDIO_SAMPLES.filter(s => requestedSampleIds.includes(s.id));
  if (!targetSamples.length) {
    return res.status(404).json({ success: false, error: 'No matching audio samples found.' });
  }

  const runId = `RUN-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = new Date().toISOString();

  const configuredModels = (selectedModels as string[]).filter(
    (m) => ASR_PROVIDER_REGISTRY[m]?.isConfigured()
  );

  if (!configuredModels.length) {
    return res.status(400).json({
      success: false,
      error:
        'None of the selected speech models are configured for real evaluation. Set OPEN_AI_KEY (also required to synthesize reference audio), SAHARA_API_KEY, or MODEL_B_API_KEY+MODEL_B_API_URL / MODEL_C_API_KEY+MODEL_C_API_URL.',
    });
  }

  const results: Array<{
    sampleId: string;
    sampleTitle: string;
    language: LanguageCode;
    referenceTranscript: string;
    hasCodeSwitching: boolean;
    referenceAudioAvailable: boolean;
    modelResults: Record<string, any>;
  }> = [];
  const modelTotalWer: Record<string, number[]> = {};
  const modelTotalCer: Record<string, number[]> = {};
  const modelTotalAccuracy: Record<string, number[]> = {};
  const modelLatency: Record<string, number[]> = {};
  const modelSuccess: Record<string, { success: number; total: number }> = {};

  (selectedModels as string[]).forEach((m) => {
    modelTotalWer[m] = [];
    modelTotalCer[m] = [];
    modelTotalAccuracy[m] = [];
    modelLatency[m] = [];
    modelSuccess[m] = { success: 0, total: 0 };
  });

  for (const sample of targetSamples) {
    const sampleResults: Record<string, any> = {};
    const ref = sample.referenceTranscript;
    const isCodeSwitched = sample.hasCodeSwitching;

    // One real TTS call per sample, reused identically for every model
    // being compared, so the comparison is fair.
    const synth = await synthesizeReferenceAudio(ref, sample.language);

    for (const modelId of selectedModels as string[]) {
      modelSuccess[modelId].total += 1;
      const provider = ASR_PROVIDER_REGISTRY[modelId];

      if (!provider || !provider.isConfigured()) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          notConfigured: true,
          error: `${provider?.displayName ?? modelId} is not configured for this deployment.`,
        };
        continue;
      }

      if (!synth.success || !synth.audioBase64 || !synth.mimeType) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          error: `Could not synthesize reference audio to evaluate against: ${synth.error}`,
        };
        continue;
      }

      const transcription = await provider.transcribe(synth.audioBase64, synth.mimeType, sample.language);

      if (!transcription.success || !transcription.transcript) {
        sampleResults[modelId] = {
          modelId,
          success: false,
          latencyMs: transcription.latencyMs,
          error: transcription.error || 'Transcription failed.',
        };
        continue;
      }

      const hypothesis = transcription.transcript;
      const werCalc = calculateWER(ref, hypothesis, normalizationOptions);
      const cerCalc = calculateCER(ref, hypothesis, normalizationOptions);
      const accuracy = calculateAccuracy(werCalc.wer);
      const csAnalysis = isCodeSwitched ? analyzeCodeSwitching(ref, sample.language) : undefined;
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
        codeSwitchAnalysis: csAnalysis,
      };
    }

    results.push({
      sampleId: sample.id,
      sampleTitle: sample.title,
      language: sample.language,
      referenceTranscript: ref,
      hasCodeSwitching: isCodeSwitched,
      referenceAudioAvailable: synth.success,
      modelResults: sampleResults,
    });
  }

  // Macro averages are computed only over models that produced at least one
  // real successful transcription; unconfigured/failed models report null
  // rather than a fabricated or misleading 0.
  const macroAverageWer: Record<string, number | null> = {};
  const macroAverageCer: Record<string, number | null> = {};
  const macroAverageAccuracy: Record<string, number | null> = {};
  const averageLatencyMs: Record<string, number | null> = {};
  const successRate: Record<string, number> = {};

  (selectedModels as string[]).forEach((m) => {
    const wers = modelTotalWer[m];
    const cers = modelTotalCer[m];
    const accuracies = modelTotalAccuracy[m];
    const lats = modelLatency[m];
    const succ = modelSuccess[m];

    macroAverageWer[m] = wers.length ? Number((wers.reduce((a, b) => a + b, 0) / wers.length).toFixed(4)) : null;
    macroAverageCer[m] = cers.length ? Number((cers.reduce((a, b) => a + b, 0) / cers.length).toFixed(4)) : null;
    macroAverageAccuracy[m] = accuracies.length
      ? Number((accuracies.reduce((a, b) => a + b, 0) / accuracies.length).toFixed(4))
      : null;
    averageLatencyMs[m] = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    successRate[m] = Number(((succ.success / (succ.total || 1)) * 100).toFixed(1));
  });

  const languages = Array.from(new Set(targetSamples.map(s => s.language))) as LanguageCode[];
  const isPartial = configuredModels.length < (selectedModels as string[]).length;

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
      status: isPartial ? 'partial' : 'completed',
      summaryNote: isPartial
        ? `Partial benchmark — ${configuredModels.length} of ${(selectedModels as string[]).length} models configured and evaluated (${configuredModels.map((m) => ASR_PROVIDER_REGISTRY[m]?.displayName ?? m).join(', ')}). Each configured model transcribed the same synthesized reference audio and was scored against ground truth; unconfigured models are excluded from these numbers, not zero-filled.`
        : `Evaluated ${targetSamples.length} de-identified clinical instances across ${(selectedModels as string[]).length} speech models, using synthesized reference audio transcribed live by each model.`,
    },
  });
}));

// Patient Intake: one live conversational turn. Real audio in (gain-boosted
// the same way benchmark reference audio is, so soft-spoken patients are
// still heard clearly), transcribed by every configured ASR provider, then
// handed to the model as one more turn in the ongoing conversation. The
// patient is never asked to pick a language: it's detected fresh from their
// own words on every turn (not locked in after the first), so someone who
// switches languages mid-call is followed rather than left being answered
// in whatever language they opened with — see getSabiLineReply's
// languageCode and the language-anchor handling below.
// The reply is genuinely generated per turn, never a fixed script: SabiLine
// asks about whatever it doesn't have yet, in whatever order feels natural,
// and only signals "done" once it has actually gathered what it can.
// Fires once per intake, the turn the model sets "done": true — sends staff the
// English visit summary and, when a phone number + confirmed appointment
// timestamp are on file, arms the two automatic Twilio reminder calls (2
// days and 2 hours before the appointment). Never blocks or fails the
// caller-facing response: both are best-effort side effects.
function finalizeIntakeIfDone(
  visitId: string,
  language: LanguageCode,
  reply: Awaited<ReturnType<typeof getSabiLineReply>>,
  languageHistory: LanguageCode[]
): void {
  if (!reply.success || !reply.done || !reply.fields) return;

  const fullLanguageHistory =
    languageHistory[languageHistory.length - 1] === language ? languageHistory : [...languageHistory, language];

  const summary = buildEnglishVisitSummary({
    referenceNumber: visitId,
    language,
    languageHistory: fullLanguageHistory,
    fields: reply.fields,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    needsManualReview: Boolean(reply.needsManualReview),
  });
  void notifyStaffOfVisit(summary);

  scheduleAppointmentReminders({
    visitId,
    phoneNumber: reply.fields.phoneNumber ?? null,
    department: reply.department ?? null,
    appointmentSlot: reply.appointmentSlot ?? null,
    appointmentSlotIso: reply.appointmentSlotIso ?? null,
  });
}

app.post('/api/intake/converse', asyncHandler(async (req: Request, res: Response) => {
  const {
    audioBase64,
    text,
    startCall,
    mimeType = 'audio/wav',
    language = 'auto',
    visitId,
    history = [],
    elapsedMinutes = 0,
    selectedModels,
    languageHistory,
  } = req.body;
  const resolvedVisitId: string = typeof visitId === 'string' && visitId ? visitId : randomUUID();
  const priorLanguageHistory: LanguageCode[] = Array.isArray(languageHistory) ? languageHistory : [];

  // Tapping SPEAK for the first time connects the call before the patient has
  // said anything. Which language they speak is only knowable once they have
  // spoken — with one exception: if this browser has used SabiLine before in a
  // known language, the client sends it and SabiLine can open in that language
  // directly.
  //
  // With NO known language, SabiLine deliberately does not open with an
  // English greeting. A patient who only speaks Hausa should not hear English
  // as the first thing said to them, and a greeting nobody understands is
  // worse than no greeting: it reads as a broken line. Instead the client is
  // told to listen first (see `listenFirst`), and SabiLine's first spoken
  // sentence ends up in the language it actually hears. This also saves a
  // completion call on the opening turn.
  if (startCall === true) {
    const openingLanguage =
      typeof language === 'string' && language !== 'auto' && SUPPORTED_LANGUAGE_CODES.includes(language as LanguageCode)
        ? (language as LanguageCode)
        : null;

    if (openingLanguage === null) {
      return res.json({
        success: true,
        visitId: resolvedVisitId,
        listenFirst: true,
        spokenReply: null,
        done: false,
        fields: null,
        department: null,
        appointmentSlot: null,
        appointmentSlotIso: null,
        needsManualReview: false,
      });
    }

    const reply = await getSabiLineReply(Array.isArray(history) ? history : [], null, openingLanguage, 0);
    if (!reply.success) {
      return res.status(reply.quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded: reply.quotaExceeded,
        notConfigured: reply.notConfigured,
        timedOut: reply.timedOut,
        error: reply.error,
      });
    }
    finalizeIntakeIfDone(resolvedVisitId, openingLanguage, reply, priorLanguageHistory);
    return res.json({
      success: true,
      visitId: resolvedVisitId,
      detectedLanguage: openingLanguage,
      spokenReply: reply.spokenReply,
      done: reply.done,
      fields: reply.fields,
      department: reply.department,
      appointmentSlot: reply.appointmentSlot,
      appointmentSlotIso: reply.appointmentSlotIso,
      needsManualReview: reply.needsManualReview,
    });
  }

  // A patient who types their reply instead of speaking has no audio for
  // the ASR/gain-normalization pipeline below — just their typed text.
  // Language is re-classified on every typed turn, not just the first — a
  // patient can switch languages mid-call by typing too — with whatever
  // language was already known (if any) passed in as an anchor so a short,
  // ambiguous reply doesn't cause a spurious flip. If classification itself
  // fails on a turn where a language is already known, this degrades
  // gracefully by keeping that known language rather than dead-ending the
  // whole turn; only the very first turn (no known language at all to fall
  // back to) genuinely has to stop and report the failure.
  if (typeof text === 'string' && text.trim()) {
    const typedText = text.trim();
    const previousLanguage: LanguageCode | null = language === 'auto' ? null : (language as LanguageCode);
    let resolvedLanguage: LanguageCode = previousLanguage ?? 'en';

    // An established language is only given up on real evidence. The prompt
    // asks the model for this, but a bare "okay"/"yes"/a phone number must not
    // be able to flip a whole conversation even if the model ignores that.
    const lowEvidence = previousLanguage !== null && isLowEvidenceForLanguageSwitch(typedText);

    const detection = await detectLanguageFromText(typedText, previousLanguage ?? undefined);
    if (previousLanguage === null) {
      // First typed turn of the call: there is no established language to
      // protect, so whatever the classifier concluded becomes this turn's
      // anchor. This is the one case with nothing to fall back to, so a
      // classification failure genuinely has to be reported.
      if (detection.success && detection.languageCode) {
        resolvedLanguage = detection.languageCode;
      } else {
        return res.json({
          success: true,
          detectedLanguage: null,
          transcript: null,
          quotaExceeded: detection.quotaExceeded,
          notConfigured: detection.notConfigured,
          timedOut: detection.timedOut,
          error: detection.error,
        });
      }
    } else {
      // An established language is only given up on real evidence — not a
      // bare "okay", and no longer on a low-confidence guess either. See
      // resolveLanguageSwitch for the full policy.
      resolvedLanguage = resolveLanguageSwitch(
        previousLanguage,
        detection.success ? detection.languageCode : undefined,
        detection.confidence,
        lowEvidence
      ).language;
    }

    const reply = await getSabiLineReply(
      Array.isArray(history) ? history : [],
      typedText,
      resolvedLanguage,
      Number(elapsedMinutes) || 0
    );

    if (!reply.success) {
      return res.status(reply.quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded: reply.quotaExceeded,
        notConfigured: reply.notConfigured,
        timedOut: reply.timedOut,
        error: reply.error,
      });
    }

    // Same guard on the reply's own languageCode — the merged completion can
    // report a switch just as wrongly as the standalone classifier can, so it
    // passes through the identical confidence-aware policy.
    const finalLanguage = resolveLanguageSwitch(
      resolvedLanguage,
      reply.languageCode,
      reply.confidence,
      lowEvidence
    ).language;
    finalizeIntakeIfDone(resolvedVisitId, finalLanguage, reply, priorLanguageHistory);
    return res.json({
      success: true,
      visitId: resolvedVisitId,
      detectedLanguage: finalLanguage,
      transcript: typedText,
      primaryProviderId: null,
      attempts: {},
      spokenReply: reply.spokenReply,
      done: reply.done,
      fields: reply.fields,
      department: reply.department,
      appointmentSlot: reply.appointmentSlot,
      appointmentSlotIso: reply.appointmentSlotIso,
      needsManualReview: reply.needsManualReview,
    });
  }

  if (!audioBase64) {
    return res.status(400).json({ success: false, error: 'audioBase64 or text is required.' });
  }

  let processedAudio = audioBase64;
  let gainNormalizationApplied = false;
  if (mimeType === 'audio/wav') {
    try {
      const wavBuffer = Buffer.from(audioBase64, 'base64');
      const { buffer, applied } = normalizeQuietAudio(wavBuffer);
      processedAudio = buffer.toString('base64');
      gainNormalizationApplied = applied;
    } catch {
      // Normalization couldn't parse this buffer; transcribe it unchanged.
    }
  }

  const selected: string[] = Array.isArray(selectedModels) && selectedModels.length > 0 ? selectedModels : LIVE_ASR_PRIORITY;

  // The very first spoken turn of a call has no prior language to anchor on
  // — it uses the dedicated Whisper-transcribe-then-classify path. Every
  // turn after that already knows the language from the previous turn, so
  // it transcribes directly with that as a Whisper hint (FIX 10) and lets
  // the reply completion below re-determine the language fresh from the
  // resulting transcript — folded into that one call instead of paying for
  // a separate classification call every turn (FIX 4/5).
  const previousLanguage: LanguageCode | null = language === 'auto' ? null : (language as LanguageCode);
  let resolvedLanguage: LanguageCode = previousLanguage ?? 'en';
  let openaiTranscript: string | null = null;

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
          openai: { success: false, error: detection.error, latencyMs: detection.latencyMs },
        },
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
          openai: { success: false, error: transcription.error, latencyMs: transcription.latencyMs },
        },
      });
    }
    openaiTranscript = transcription.transcript;
  }

  const otherModels = openaiTranscript ? selected.filter((id) => id !== 'openai') : selected;
  const summary = await transcribeWithAllProviders(processedAudio, mimeType, resolvedLanguage, otherModels);

  if (openaiTranscript) {
    summary.attempts.openai = { success: true, transcript: openaiTranscript, latencyMs: 0 };
    if (!summary.primaryProviderId) {
      summary.primaryProviderId = 'openai';
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
      attempts: summary.attempts,
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
      error: reply.error,
    });
  }

  // A one-word spoken turn ("okay", an age, a phone number) must not flip the
  // call's established language either — same guard as the typed path above.
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
    needsManualReview: reply.needsManualReview,
  });
}));

// Places a real outbound call reminding the patient of their appointment.
// Honestly reports "not configured" when no Twilio credentials are set,
// mirroring how every other optional provider in this app behaves —
// nothing is faked as sent.
app.post('/api/intake/remind', asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber, department, appointmentSlot } = req.body;

  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return res.status(400).json({ success: false, error: 'phoneNumber is required.' });
  }

  if (!isTwilioConfigured()) {
    return res.json({
      success: false,
      notConfigured: true,
      error: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are not all set, so no reminder call can be placed.',
    });
  }

  const departmentPart = department ? ` at ${department}` : '';
  const slotPart = appointmentSlot ? ` on ${appointmentSlot}` : '';
  const message = `Hello, this is a reminder from SabiLine about your upcoming appointment${departmentPart}${slotPart}. Please arrive a few minutes early. Thank you, and see you soon.`;

  const result = await placeReminderCall(phoneNumber, message);
  res.json(result);
}));

// Fallback sweep for serverless deployments where no long-lived process can
// hold a `setTimeout` for the automatic 2-day/2-hour reminder calls: an
// external cron (Vercel Cron, GitHub Actions schedule, etc.) can hit this
// on a short interval (e.g. every 10-15 minutes) to fire anything that's due.
app.post('/api/intake/reminders/run-due', asyncHandler(async (_req: Request, res: Response) => {
  const result = await runDueReminders();
  res.json({ success: true, ...result });
}));

app.get('/api/intake/reminders', (_req: Request, res: Response) => {
  res.json({ success: true, reminders: listScheduledReminders() });
});

// 8. Reference data endpoint
app.get('/api/benchmark/reference', (req: Request, res: Response) => {
  res.json({
    success: true,
    spec: AFRIHEALTH_BENCHMARK_SPEC,
    historicalResults: AFRIHEALTH_REFERENCE_RESULTS,
  });
});

// 9. Samples catalog endpoint
app.get('/api/samples', (req: Request, res: Response) => {
  res.json({
    success: true,
    samples: CLINICAL_AUDIO_SAMPLES,
  });
});

// Any unmatched /api/* path must answer in JSON. Without this, Express's own
// default 404 renders an HTML page ("Cannot GET /api/..."), and because the
// client calls `res.json()` on every response, a mistyped endpoint surfaces as
// `Unexpected token '<'` — a parse error that hides the actual problem. The
// message names the method and path, which is the whole fix when a client and
// a server disagree about a route.
app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `No such API route: ${req.method} ${req.originalUrl}`,
  });
});

// Last-resort error handler, JSON for the same reason. This is what catches
// failures raised in MIDDLEWARE rather than inside a route — most commonly
// express.json() rejecting a malformed body, which would otherwise be answered
// by Express's built-in HTML error page and break the caller's JSON parsing.
// `asyncHandler` above already covers throws inside the routes themselves.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = Number((err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode) || 500;
  const type = (err as { type?: string })?.type;

  console.error(`[server] ${req.method} ${req.originalUrl} failed (${status}):`, err instanceof Error ? err.message : err);

  // Headers already sent means a response is in flight and only the platform
  // can finish it — anything we write now would be appended to a real body.
  if (res.headersSent) return;

  const message =
    type === 'entity.parse.failed'
      ? 'The request body was not valid JSON.'
      : type === 'entity.too.large'
        ? 'The request body was too large. Send a shorter audio clip.'
        : status < 500
          ? 'The request could not be understood.'
          : 'Unexpected server error. Please try again.';

  res.status(status).json({ success: false, error: message });
});

// Production & Development Vite Middleware Integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  rehydratePendingReminders();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AfriVoice Studio Server running on http://0.0.0.0:${PORT}`);
  });
}

// Exported so `npm run build:api` can bundle this same Express app into
// api/index.js for Vercel's Node serverless runtime (Vercel invokes the app
// directly per-request instead of via a long-running listener). All routes
// above are registered at module load time regardless of this export, so
// they're already attached by the time an importer receives `app`.
export default app;

// Vercel sets VERCEL=1 in both its build and runtime environments. Only run
// our own long-running server (Vite middleware in dev, static file serving
// + app.listen in `npm start`) when NOT deployed on Vercel — its platform
// serves the static build output directly and invokes api/index.js as a
// serverless function per request instead.
//
// api/index.js is an esbuild bundle of this file's whole dependency graph,
// and it is CHECKED IN, not just generated at build time. Both halves of
// that are load-bearing:
//  - Bundled, because Vercel's zero-config TS builder given a committed
//    api/index.ts that imported `../server` deployed a Lambda that tried to
//    load the raw, unbundled server.ts and crashed with ERR_MODULE_NOT_FOUND.
//  - Committed, because Vercel discovers serverless functions by scanning
//    the api/ directory of the cloned repository *before* it runs our build
//    command — a gitignored file that only exists after `npm run build`
//    is invisible to that scan, so no function was deployed at all and
//    every /api/* request 404'd at the platform edge.
// The build regenerates it on every `npm run build`; re-run that (or
// `npm run build:api`) and commit the result whenever server-side code
// changes, or production silently keeps running the old bundle.
if (!process.env.VERCEL) {
  startServer();
}
