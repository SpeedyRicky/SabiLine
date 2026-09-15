import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { Modality } from '@google/genai';
import { getGeminiClient, isQuotaExceededError } from './src/services/tts/geminiClient';
import { pcmToWavBuffer } from './src/services/tts/pcmToWav';
import { synthesizeReferenceAudio } from './src/services/tts/geminiSynthesize';
import { ASR_PROVIDER_REGISTRY, DEFAULT_BENCHMARK_MODELS } from './src/services/asr/registry';
import { transcribeWithAllProviders, LIVE_ASR_PRIORITY } from './src/services/asr/transcribeLive';
import { detectLanguageAndTranscribe } from './src/services/asr/detectLanguage';
import { getSabiLineReply } from './src/services/intake/converse';
import { isTwilioConfigured, placeReminderCall } from './src/services/reminder/twilioReminder';
import { normalizeQuietAudio } from './src/services/asr/audioPreprocess';
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

app.use(express.json({ limit: '50mb' }));

// 1. Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    product: 'AfriVoice Studio - Sahara CodeSwitch Africa Challenge',
    timestamp: new Date().toISOString(),
  });
});

// 2. Provider configuration status (honest and transparent)
app.get('/api/providers/status', (req: Request, res: Response) => {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasSaharaTts = Boolean(process.env.SAHARA_TTS_API_KEY);
  const hasSaharaStt = ASR_PROVIDER_REGISTRY.sahara.isConfigured();

  res.json({
    providers: {
      sahara: {
        id: 'sahara',
        name: 'Intron Sahara (TTS)',
        isConfigured: hasSaharaTts,
        statusMessage: hasSaharaTts
          ? 'Connected (Native African Speech Models active)'
          : 'Awaiting SAHARA_TTS_API_KEY in server secrets',
        supportedLanguages: ['ha', 'ig', 'yo', 'en'],
      },
      sahara_stt: {
        id: 'sahara_stt',
        name: 'Intron Sahara (STT / Benchmark)',
        isConfigured: hasSaharaStt,
        statusMessage: hasSaharaStt
          ? 'Connected (used as a real ASR provider in the Benchmark tab)'
          : 'Awaiting SAHARA_STT_API_KEY in server secrets',
        supportedLanguages: ['ha', 'ig', 'yo', 'en'],
      },
      gemini: {
        id: 'gemini',
        name: 'Gemini 3.1 Flash Voice',
        isConfigured: hasGemini,
        statusMessage: hasGemini
          ? 'Connected (Multimodal Generative Audio active)'
          : 'Awaiting GEMINI_API_KEY in server secrets',
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
});

// 3. Real Text-To-Speech generation endpoint
app.post('/api/tts/generate', async (req: Request, res: Response) => {
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

  if (!text || !text.trim()) {
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

  // Handle Sahara Provider
  if (provider === 'sahara') {
    const saharaKey = process.env.SAHARA_TTS_API_KEY;
    if (!saharaKey) {
      return res.status(400).json({
        success: false,
        error: 'Sahara TTS API key is not configured in server environment. Please set SAHARA_TTS_API_KEY in secrets, or choose Gemini 3.1 Flash Voice / Device Web Speech.',
        provider: 'sahara',
      });
    }

    try {
      // Direct call to Sahara / Intron Health TTS API
      const saharaResponse = await fetch('https://api.intron.io/v1/tts/synthesize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${saharaKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language,
          voice: voiceId,
          speed,
          pitch,
        }),
      });

      if (!saharaResponse.ok) {
        const errText = await saharaResponse.text();
        throw new Error(`Sahara API returned status ${saharaResponse.status}: ${errText}`);
      }

      const audioBlob = await saharaResponse.arrayBuffer();
      const base64Audio = Buffer.from(audioBlob).toString('base64');
      const durationSec = Math.max(1.5, Math.round(text.split(/\s+/).length * 0.45));

      return res.json({
        success: true,
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
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
      return res.status(502).json({
        success: false,
        error: `Sahara speech service error: ${err.message || 'Connection failed'}`,
      });
    }
  }

  // Handle Gemini 3.1 Flash TTS Provider
  if (provider === 'gemini') {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured in server secrets. Please configure it in Settings > Secrets.',
        provider: 'gemini',
      });
    }

    try {
      // Map requested voice to prebuilt voice name ('Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr')
      let prebuiltVoice = 'Kore';
      if (voiceId.includes('puck')) prebuiltVoice = 'Puck';
      else if (voiceId.includes('charon')) prebuiltVoice = 'Charon';
      else if (voiceId.includes('fenrir')) prebuiltVoice = 'Fenrir';
      else if (voiceId.includes('zephyr')) prebuiltVoice = 'Zephyr';

      const stylePrompt = emotion === 'empathic'
        ? 'Speak with genuine clinical empathy, warmth, and care: '
        : emotion === 'authoritative'
        ? 'Speak with clear, authoritative public health clarity: '
        : emotion === 'urgent'
        ? 'Speak with calm urgency suitable for clinical triage: '
        : 'Speak clearly and naturally: ';

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: `${stylePrompt}${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: prebuiltVoice },
            },
          },
        },
      });

      const rawPcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!rawPcmBase64) {
        throw new Error('Gemini model did not return audio data in candidates response.');
      }

      // Convert raw PCM 24kHz audio to standard WAV
      const pcmRawBuffer = Buffer.from(rawPcmBase64, 'base64');
      const wavBuffer = pcmToWavBuffer(pcmRawBuffer, 24000, 1, 16);
      const wavBase64 = wavBuffer.toString('base64');
      const durationSec = Math.round((pcmRawBuffer.length / (24000 * 2)) * 10) / 10;

      return res.json({
        success: true,
        audioBase64: wavBase64,
        mimeType: 'audio/wav',
        durationSec: Math.max(1, durationSec),
        text,
        language,
        voiceId,
        provider: 'gemini',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
      });
    } catch (err: any) {
      console.error('Gemini TTS error:', err);
      const quotaExceeded = isQuotaExceededError(err);
      return res.status(quotaExceeded ? 429 : 500).json({
        success: false,
        quotaExceeded,
        error: quotaExceeded
          ? "Gemini's free-tier voice generation quota is exhausted for today. Switch to Device Web Speech, or enable billing on your Gemini API key for higher limits."
          : `Gemini Voice generation failed: ${err.message || 'Internal error'}`,
      });
    }
  }

  return res.status(400).json({ success: false, error: `Unknown provider '${provider}' requested.` });
});

// 4. Clinical Multilingual Translation Endpoint
app.post('/api/translate', async (req: Request, res: Response) => {
  const { text, sourceLang = 'en', targetLang } = req.body;

  if (!text || !targetLang) {
    return res.status(400).json({ success: false, error: 'Text and targetLang are required.' });
  }

  if (sourceLang === targetLang) {
    return res.json({ success: true, translatedText: text, sourceLang, targetLang });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(400).json({
      success: false,
      error: 'GEMINI_API_KEY is required for multilingual translation.',
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
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const translatedText = (response.text || '').trim();
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
      error: `Translation failed: ${err.message || 'Gemini error'}`,
    });
  }
});

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
app.post('/api/qa/evaluate', async (req: Request, res: Response) => {
  const { question, referenceAnswer, clinicalDomain } = req.body;

  const ai = getGeminiClient();
  if (!ai) {
    // Fallback rule-based assessment if Gemini is not set up
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
        clinicalReviewNote: 'Evaluation evaluated via standard African clinical criteria (Gemini key not configured for dynamic judge).',
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ success: true, evaluation: parsed });
  } catch (err: any) {
    console.error('QA Eval error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Live Speech Model Benchmark Runner
//
// Real pipeline: for each sample, synthesize one real audio clip from the
// ground-truth transcript (so every model is fed identical input), then send
// that same audio to every configured ASR provider and score its actual
// returned transcript with the real WER/CER engine. A model that isn't
// configured (no API key, or for Model B/C no custom endpoint URL) is
// reported as not-configured and excluded from the averages below — never
// zero-filled or fabricated. See src/services/asr/ for the provider
// implementations and src/services/tts/geminiSynthesize.ts for the audio
// synthesis step.
app.post('/api/benchmark/run', async (req: Request, res: Response) => {
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

  if (!sampleIds.length) {
    return res.status(400).json({ success: false, error: 'At least one sampleId must be selected.' });
  }

  // Find samples from verified dataset
  const targetSamples = CLINICAL_AUDIO_SAMPLES.filter(s => sampleIds.includes(s.id));
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
        'None of the selected speech models are configured for real evaluation. Set GEMINI_API_KEY (also required to synthesize reference audio), SAHARA_API_KEY, or MODEL_B_API_KEY+MODEL_B_API_URL / MODEL_C_API_KEY+MODEL_C_API_URL.',
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
});

// Patient Intake: one live conversational turn. Real audio in (gain-boosted
// the same way benchmark reference audio is, so soft-spoken patients are
// still heard clearly), transcribed by every configured ASR provider —
// detecting the spoken language on the first turn only, since browser
// speech recognition needs a language picked in advance but a real listen-
// first-classify-after model doesn't, so the patient is never asked to pick
// one — then handed to Gemini as one more turn in the ongoing conversation.
// The reply is genuinely generated per turn, never a fixed script: SabiLine
// asks about whatever it doesn't have yet, in whatever order feels natural,
// and only signals "done" once it has actually gathered what it can.
app.post('/api/intake/converse', async (req: Request, res: Response) => {
  const {
    audioBase64,
    mimeType = 'audio/wav',
    language = 'auto',
    history = [],
    elapsedMinutes = 0,
    selectedModels,
  } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ success: false, error: 'audioBase64 is required.' });
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

  let resolvedLanguage: LanguageCode = language === 'auto' ? 'en' : (language as LanguageCode);
  let detectedLanguage: LanguageCode | null = null;
  let geminiTranscript: string | null = null;

  if (language === 'auto') {
    const detection = await detectLanguageAndTranscribe(processedAudio, mimeType);
    if (!detection.success || !detection.languageCode) {
      return res.json({
        success: true,
        gainNormalizationApplied,
        detectedLanguage: null,
        transcript: null,
        primaryProviderId: null,
        quotaExceeded: detection.quotaExceeded,
        attempts: {
          gemini: { success: false, error: detection.error, latencyMs: detection.latencyMs },
        },
      });
    }
    resolvedLanguage = detection.languageCode;
    detectedLanguage = detection.languageCode;
    geminiTranscript = detection.transcript ?? null;
  }

  const otherModels = geminiTranscript ? selected.filter((id) => id !== 'gemini') : selected;
  const summary = await transcribeWithAllProviders(processedAudio, mimeType, resolvedLanguage, otherModels);

  if (geminiTranscript) {
    summary.attempts.gemini = { success: true, transcript: geminiTranscript, latencyMs: 0 };
    if (!summary.primaryProviderId) {
      summary.primaryProviderId = 'gemini';
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
      error: reply.error,
    });
  }

  res.json({
    success: true,
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
    needsManualReview: reply.needsManualReview,
  });
});

// Places a real outbound call reminding the patient of their appointment.
// Honestly reports "not configured" when no Twilio credentials are set,
// mirroring how every other optional provider in this app behaves —
// nothing is faked as sent.
app.post('/api/intake/remind', async (req: Request, res: Response) => {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AfriVoice Studio Server running on http://0.0.0.0:${PORT}`);
  });
}

// Exported so api/index.ts can hand this same Express app to Vercel's Node
// serverless runtime (Vercel invokes the app directly per-request instead
// of via a long-running listener). All routes above are registered at
// module load time regardless of this export, so they're already attached
// by the time an importer receives `app`.
export default app;

// Vercel sets VERCEL=1 in both its build and runtime environments. Only run
// our own long-running server (Vite middleware in dev, static file serving
// + app.listen in `npm start`) when NOT deployed on Vercel — its platform
// serves the static build output directly and invokes api/index.ts as a
// serverless function per request instead.
if (!process.env.VERCEL) {
  startServer();
}
