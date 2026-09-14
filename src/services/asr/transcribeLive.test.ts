import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { transcribeWithAllProviders, LIVE_ASR_PRIORITY } from './transcribeLive';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'SAHARA_STT_API_KEY',
  'MODEL_B_API_KEY',
  'MODEL_B_API_URL',
  'MODEL_C_API_KEY',
  'MODEL_C_API_URL',
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('transcribeWithAllProviders', () => {
  it('reports every provider as not-configured, with no transcript, when nothing is set up', async () => {
    const result = await transcribeWithAllProviders('base64audio', 'audio/wav', 'en');

    expect(result.primaryProviderId).toBeNull();
    expect(result.primaryTranscript).toBeNull();
    for (const id of LIVE_ASR_PRIORITY) {
      expect(result.attempts[id].success).toBe(false);
      expect(result.attempts[id].notConfigured).toBe(true);
    }
  });

  it('uses the only configured provider as primary', async () => {
    process.env.MODEL_B_API_KEY = 'fake-key';
    process.env.MODEL_B_API_URL = 'https://example.com/model-b';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transcript: 'my stomach hurts' }) })
    );

    const result = await transcribeWithAllProviders('base64audio', 'audio/wav', 'en');

    expect(result.primaryProviderId).toBe('model_b');
    expect(result.primaryTranscript).toBe('my stomach hurts');
    expect(result.attempts.sahara.notConfigured).toBe(true);
    expect(result.attempts.gemini.notConfigured).toBe(true);
  });

  it('prefers Sahara over the benchmark endpoints and Gemini when all three succeed', async () => {
    process.env.SAHARA_STT_API_KEY = 'fake-key';
    process.env.MODEL_B_API_KEY = 'fake-key';
    process.env.MODEL_B_API_URL = 'https://example.com/model-b';
    process.env.GEMINI_API_KEY = 'fake-key';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('intron.io')) {
          return { ok: true, json: async () => ({ transcript: 'sahara transcript' }) };
        }
        return { ok: true, json: async () => ({ transcript: 'model b transcript' }) };
      })
    );

    const result = await transcribeWithAllProviders('base64audio', 'audio/wav', 'en', ['sahara', 'model_b']);

    expect(result.primaryProviderId).toBe('sahara');
    expect(result.primaryTranscript).toBe('sahara transcript');
  });

  it('falls through to the next provider by priority when the preferred one fails', async () => {
    process.env.SAHARA_STT_API_KEY = 'fake-key';
    process.env.MODEL_B_API_KEY = 'fake-key';
    process.env.MODEL_B_API_URL = 'https://example.com/model-b';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('intron.io')) {
          return { ok: false, status: 500, text: async () => 'sahara down' };
        }
        return { ok: true, json: async () => ({ transcript: 'model b transcript' }) };
      })
    );

    const result = await transcribeWithAllProviders('base64audio', 'audio/wav', 'en', ['sahara', 'model_b']);

    expect(result.attempts.sahara.success).toBe(false);
    expect(result.primaryProviderId).toBe('model_b');
    expect(result.primaryTranscript).toBe('model b transcript');
  });
});
