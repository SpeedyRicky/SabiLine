// Central Types for AfriVoice Studio & Sahara CodeSwitch Challenge

export type LanguageCode = 'en' | 'fr' | 'zh' | 'hi' | 'es' | 'ig' | 'ha' | 'yo';

export interface LanguageInfo {
  code: LanguageCode;
  name: string;
  nativeName: string;
  african: boolean;
  region: string;
  flag: string;
  description: string;
  diacriticsSupported?: boolean;
}

export const LANGUAGES: LanguageInfo[] = [
  {
    code: 'ha',
    name: 'Hausa',
    nativeName: 'Harshen Hausa',
    african: true,
    region: 'West Africa / Sahel (Nigeria, Niger, Ghana)',
    flag: '🇳🇬',
    description: 'Chadic language spoken by over 80 million people, major lingua franca across northern Nigeria and West Africa.',
    diacriticsSupported: true,
  },
  {
    code: 'ig',
    name: 'Igbo',
    nativeName: 'Asụsụ Igbo',
    african: true,
    region: 'Southeastern Nigeria',
    flag: '🇳🇬',
    description: 'Tonal Benue-Congo language spoken by ~45 million people with rich orthographic tone markers and vowel harmony.',
    diacriticsSupported: true,
  },
  {
    code: 'yo',
    name: 'Yoruba',
    nativeName: 'Èdè Yorùbá',
    african: true,
    region: 'Southwestern Nigeria, Benin, Togo',
    flag: '🇳🇬',
    description: 'Highly tonal language spoken by ~50 million people featuring distinctive tonal diacritics (acute, grave, macron).',
    diacriticsSupported: true,
  },
  {
    code: 'en',
    name: 'English (African / Global)',
    nativeName: 'English',
    african: false,
    region: 'Pan-African & Global (Nigerian English, West African Pidgin)',
    flag: '🌍',
    description: 'Official healthcare lingua franca across Nigeria, Ghana, Kenya, South Africa, and international agencies.',
  },
  {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    african: false,
    region: 'Francophone Africa & Global (Senegal, DRC, Côte d\'Ivoire)',
    flag: '🇫🇷',
    description: 'Major official and community language across 20+ African nations and public healthcare systems.',
  },
  {
    code: 'zh',
    name: 'Chinese (Mandarin)',
    nativeName: '中文 (普通话)',
    african: false,
    region: 'Global / Diplomatic & Healthcare Exchange',
    flag: '🇨🇳',
    description: 'Global language used in international medical missions and health education programs.',
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    african: false,
    region: 'Global / South Asian diaspora',
    flag: '🇮🇳',
    description: 'Major global language spoken by over 600 million people worldwide.',
  },
  {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    african: false,
    region: 'Global / Equatorial Guinea',
    flag: '🇪🇸',
    description: 'Global language with official status in Equatorial Guinea and widespread international medical literature.',
  },
];

export type ProviderId = 'sahara' | 'gemini' | 'browser';

export interface ProviderCapability {
  id: ProviderId;
  name: string;
  description: string;
  supportedLanguages: LanguageCode[];
  supportsAfricanTones: boolean;
  supportsCodeSwitching: boolean;
  requiresApiKey: boolean;
  apiKeyEnvVar: string;
  isConfigured: boolean;
  statusMessage: string;
  badge: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  provider: ProviderId;
  gender: 'female' | 'male' | 'neutral';
  accent: string;
  language: LanguageCode;
  supportedStyles?: string[];
  recommendedFor?: string;
}

export interface TTSRequest {
  text: string;
  language: LanguageCode;
  voiceId: string;
  provider: ProviderId;
  speed?: number;
  pitch?: number;
  emotion?: 'neutral' | 'empathic' | 'authoritative' | 'urgent';
}

export interface TTSResult {
  id: string;
  audioBase64?: string;
  audioUrl?: string;
  mimeType: string;
  durationSec: number;
  text: string;
  language: LanguageCode;
  voiceId: string;
  provider: ProviderId;
  timestamp: string;
  fallbackUsed?: boolean;
  note?: string;
}

export interface MultiLanguageRequest {
  originalText: string;
  sourceLanguage: LanguageCode;
  targetLanguages: LanguageCode[];
  translateFirst: boolean;
  provider: ProviderId;
}

export interface MultiLanguageResultItem {
  language: LanguageCode;
  translatedText: string;
  status: 'pending' | 'translating' | 'synthesizing' | 'success' | 'unsupported' | 'error';
  audioResult?: TTSResult;
  error?: string;
  provider: ProviderId;
  voiceName: string;
}

// Benchmark Interfaces (Inspired by Intron AfriHealth MultiBench)
export interface AudioSample {
  id: string;
  title: string;
  clinicalDomain: 'maternal_health' | 'triage' | 'malaria' | 'cardiology' | 'vaccination' | 'pharmacy';
  audioUrl?: string;
  durationSec: number;
  language: LanguageCode;
  accent: string;
  speakerMetadata: SpeakerMetadata;
  referenceTranscript: string;
  normalizedReference?: string;
  hasCodeSwitching: boolean;
  codeSwitchDetails?: {
    primaryLang: LanguageCode;
    switchedLang: LanguageCode;
    switchCount: number;
  };
  consentVerified: boolean;
  piiScrubbed: boolean;
}

export interface SpeakerMetadata {
  speakerId: string; // anonymized, e.g. "SPK_NG_HA_042"
  region: string; // e.g. "Northern Nigeria"
  dialect?: string;
  deIdentified: true;
}

export interface BenchmarkModelConfig {
  id: string;
  name: string;
  vendor: string;
  version: string;
  description: string;
  specialization: string;
  isLiveConfigured: boolean;
}

// wer/cer/hypothesisTranscript/errorAnalysis are only present when
// success is true — an unconfigured model, or one whose real API call
// failed, reports success:false with an `error` and no fabricated metrics.
export interface ModelInferenceResult {
  modelId: string;
  hypothesisTranscript?: string;
  normalizedHypothesis?: string;
  latencyMs?: number;
  success: boolean;
  notConfigured?: boolean;
  error?: string;
  wer?: number;
  cer?: number;
  errorAnalysis?: ErrorAnalysis;
  codeSwitchAnalysis?: CodeSwitchAnalysis;
}

export interface ErrorAnalysis {
  substitutions: number;
  deletions: number;
  insertions: number;
  wordCount: number;
  charCount: number;
  charSubstitutions: number;
  charDeletions: number;
  charInsertions: number;
  namedEntityErrors?: string[];
  medicalTermErrors?: string[];
  codeSwitchBoundaryErrors?: number;
}

export interface CodeSwitchAnalysis {
  isCodeSwitched: boolean;
  segments: LanguageSegment[];
  transitionCount: number;
  dominantLanguage: LanguageCode;
  boundaryErrorsDetected: number;
  inferredNotice: string;
}

export interface LanguageSegment {
  text: string;
  language: LanguageCode;
  startWordIdx: number;
  endWordIdx: number;
  confidence: number;
  isInferred: true;
}

export interface BenchmarkRun {
  runId: string;
  timestamp: string;
  models: string[];
  // Subset of `models` that was actually configured and evaluated for real
  // in this run; the rest are honestly reported as not-configured.
  configuredModels?: string[];
  sampleCount: number;
  languages: LanguageCode[];
  results: {
    sampleId: string;
    sampleTitle?: string;
    language?: LanguageCode;
    referenceTranscript?: string;
    hasCodeSwitching?: boolean;
    referenceAudioAvailable?: boolean;
    modelResults: Record<string, ModelInferenceResult>;
  }[];
  // null for a model with zero successful results in this run (unconfigured
  // or every attempt failed) — distinct from a real 0, never fabricated.
  macroAverageWer: Record<string, number | null>;
  macroAverageCer: Record<string, number | null>;
  averageLatencyMs: Record<string, number | null>;
  successRate: Record<string, number>;
  status: 'running' | 'completed' | 'partial' | 'failed';
  summaryNote?: string;
}

// Spoken Clinical QA evaluation
export interface SpokenQAEvaluation {
  questionId: string;
  questionText: string;
  audioDurationSec: number;
  asrModel: string;
  transcript: string;
  llmModel: string;
  clinicalAnswer: string;
  referenceAnswer: string;
  scores: {
    factuality: number; // 1-5 scale
    appropriateness: number;
    adequacy: number;
    clinicalReasoning: number;
    uncertaintyHandling: number;
    empathy: number;
    hallucinationRisk: 'low' | 'moderate' | 'high';
    localRelevance: number;
    harmAssessment: 'safe' | 'low_risk' | 'harmful';
  };
  clinicalReviewNote: string;
}

// Translation Benchmark Result
export interface TranslationBenchmarkResult {
  sampleId: string;
  sourceText: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  modelTranslation: string;
  referenceTranslation: string;
  bleuScore: number;
  chrfScore: number;
  afriCometScore?: number;
}

export interface SavedResultItem {
  id: string;
  text: string;
  language: LanguageCode;
  voiceName: string;
  provider: ProviderId;
  audioBase64?: string;
  audioUrl?: string;
  durationSec: number;
  createdAt: string;
  tags?: string[];
  note?: string;
}

// NOTE: The canonical normalization options type lives in
// services/benchmark/normalization.ts (it is what calculateWER/calculateCER
// actually accept). A second, differently-shaped copy used to live here and
// silently desynced from the engine (`lowercase` vs `toLowerCase`), which is
// why the benchmark normalization checkboxes had no effect. Import from the
// services module instead of redeclaring it here.

// The clinical QA evaluation UI renders the real AfriHealth rubric returned
// by /api/qa/evaluate, i.e. SpokenQAEvaluation['scores'] below — not a
// fictional {overallScore, dimensions, rationale} shape.
