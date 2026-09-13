import { geminiAsrProvider } from './geminiAsr';
import { saharaAsrProvider } from './saharaAsr';
import { createCustomEndpointProvider } from './customEndpointAsr';
import type { SpeechModelProvider } from './types';

export const modelBProvider = createCustomEndpointProvider(
  'model_b',
  'Model B (custom endpoint)',
  'MODEL_B_API_KEY',
  'MODEL_B_API_URL'
);

export const modelCProvider = createCustomEndpointProvider(
  'model_c',
  'Model C (custom endpoint)',
  'MODEL_C_API_KEY',
  'MODEL_C_API_URL'
);

export const ASR_PROVIDER_REGISTRY: Record<string, SpeechModelProvider> = {
  gemini: geminiAsrProvider,
  sahara: saharaAsrProvider,
  model_b: modelBProvider,
  model_c: modelCProvider,
};

export const DEFAULT_BENCHMARK_MODELS = ['gemini', 'sahara', 'model_b', 'model_c'];
