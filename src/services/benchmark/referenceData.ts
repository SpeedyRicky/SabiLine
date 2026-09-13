/**
 * Reference results from supplied AfriHealth MultiBench project
 *
 * NOTE: These are published historical benchmark results from the Intron AfriHealth MultiBench
 * paper and documentation. They are clearly preserved and labeled as historical references,
 * completely segregated from live benchmark executions created in this application.
 */

export interface HistoricalModelMetrics {
  modelName: string;
  vendor: string;
  macroAvgWer: number;
  macroAvgCer: number;
  africanLangWer: {
    hausa: number;
    igbo: number;
    yoruba: number;
    nigerianEnglish: number;
    africanFrench: number;
  };
  latencyMsAvg: number;
  africanCoveragePercent: number;
  notes: string;
}

export const AFRIHEALTH_REFERENCE_RESULTS: HistoricalModelMetrics[] = [
  {
    modelName: 'Intron Sahara',
    vendor: 'Intron Health',
    macroAvgWer: 0.244,
    macroAvgCer: 0.107,
    africanLangWer: {
      hausa: 0.218,
      igbo: 0.252,
      yoruba: 0.231,
      nigerianEnglish: 0.185,
      africanFrench: 0.260,
    },
    latencyMsAvg: 412,
    africanCoveragePercent: 96.4,
    notes: 'Strongest general African accent & tonal language resilience; native training on West & East African clinical audio.',
  },
  {
    modelName: 'Meta OmniLLM (Speech)',
    vendor: 'Meta AI',
    macroAvgWer: 0.268,
    macroAvgCer: 0.119,
    africanLangWer: {
      hausa: 0.249,
      igbo: 0.284,
      yoruba: 0.262,
      nigerianEnglish: 0.198,
      africanFrench: 0.272,
    },
    latencyMsAvg: 580,
    africanCoveragePercent: 88.5,
    notes: 'Strong multimodal speech reasoning; robust on accented multilingual speech with moderate code-switch boundary latency.',
  },
  {
    modelName: 'Azure Cognitive Speech',
    vendor: 'Microsoft',
    macroAvgWer: 0.281,
    macroAvgCer: 0.124,
    africanLangWer: {
      hausa: 0.334,
      igbo: 0.368,
      yoruba: 0.312,
      nigerianEnglish: 0.168,
      africanFrench: 0.245,
    },
    latencyMsAvg: 340,
    africanCoveragePercent: 62.0,
    notes: 'Exceptional performance on standard Nigerian English, but narrower coverage on intra-utterance tonal African code-switching.',
  },
  {
    modelName: 'Google Gemini 3.5 Transcribe',
    vendor: 'Google DeepMind',
    macroAvgWer: 0.295,
    macroAvgCer: 0.131,
    africanLangWer: {
      hausa: 0.289,
      igbo: 0.315,
      yoruba: 0.298,
      nigerianEnglish: 0.174,
      africanFrench: 0.252,
    },
    latencyMsAvg: 510,
    africanCoveragePercent: 84.0,
    notes: 'Strong semantic understanding and medical terminology retention; sensitive to tonal orthographic variations in Igbo and Yoruba.',
  },
  {
    modelName: 'Whisper Large-v3',
    vendor: 'OpenAI',
    macroAvgWer: 0.389,
    macroAvgCer: 0.182,
    africanLangWer: {
      hausa: 0.442,
      igbo: 0.510,
      yoruba: 0.428,
      nigerianEnglish: 0.224,
      africanFrench: 0.298,
    },
    latencyMsAvg: 720,
    africanCoveragePercent: 54.5,
    notes: 'Struggles noticeably on tonal distinctions and low-resource African orthography; hallucination spikes at code-switch junctures.',
  },
];

export const AFRIHEALTH_BENCHMARK_SPEC = {
  title: 'Intron AfriHealth MultiBench',
  citation: 'Supplied Competition Reference Dataset & Benchmark',
  totalInstances: 5200,
  transcriptionInstances: 3200,
  translationInstances: 1600,
  spokenQaRecordings: 398,
  totalHoursAudio: '~20 hours',
  speakerCount: 600,
  languagesCovered: 19,
  primaryAfricanLanguagesEvaluated: ['Hausa', 'Igbo', 'Yoruba', 'Nigerian English', 'Swahili', 'Twi', 'Zulu'],
  deIdentificationMethod: 'PII scrubbing with double-pass clinician & human annotator verification',
  ethicsConsent: 'Strict IRB/consented protocol for research use of de-identified healthcare audio',
};

export const AFRIHEALTH_REFERENCE_TRANSLATION_SCORES = [
  {
    pair: 'English → Hausa',
    bleu: 0.284,
    chrf: 0.532,
    afriComet: 0.684,
    domain: 'Clinical Triage & Patient Instructions',
  },
  {
    pair: 'English → Yoruba',
    bleu: 0.261,
    chrf: 0.518,
    afriComet: 0.662,
    domain: 'Antenatal & Community Health Education',
  },
  {
    pair: 'English → Igbo',
    bleu: 0.253,
    chrf: 0.498,
    afriComet: 0.648,
    domain: 'Chronic Disease & Hypertension Guidance',
  },
  {
    pair: 'English → French',
    bleu: 0.385,
    chrf: 0.642,
    afriComet: 0.792,
    domain: 'Public Health Announcements',
  },
];
