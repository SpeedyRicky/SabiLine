import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geminiAsrProvider } from './geminiAsr';
import { saharaAsrProvider } from './saharaAsr';
import { createCustomEndpointProvider } from './customEndpointAsr';

const ENV_KEYS = ['GEMINI_API_KEY', 'SAHARA_STT_API_KEY', 'TEST_MODEL_API_KEY', 'TEST_MODEL_API_URL'] as const;
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

describe('geminiAsrProvider', () => {
  it('reports not configured when GEMINI_API_KEY is unset', () => {
    expect(geminiAsrProvider.isConfigured()).toBe(false);
  });

  it('reports configured once GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    expect(geminiAsrProvider.isConfigured()).toBe(true);
  });

  it('transcribe() fails honestly without making a network call when unconfigured', async () => {
    const result = await geminiAsrProvider.transcribe('base64audio', 'audio/wav', 'en');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
    expect(result.transcript).toBeUndefined();
  });
});

describe('saharaAsrProvider', () => {
  it('reports not configured when SAHARA_STT_API_KEY is unset', () => {
    expect(saharaAsrProvider.isConfigured()).toBe(false);
  });

  it('reports configured once SAHARA_STT_API_KEY is set', () => {
    process.env.SAHARA_STT_API_KEY = 'fake-key-for-test';
    expect(saharaAsrProvider.isConfigured()).toBe(true);
  });

  it('transcribe() fails honestly without making a network call when unconfigured', async () => {
    const result = await saharaAsrProvider.transcribe('base64audio', 'audio/wav', 'ha');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SAHARA_STT_API_KEY/);
  });
});

describe('createCustomEndpointProvider (Model B / Model C extension point)', () => {
  const provider = createCustomEndpointProvider('test_model', 'Test Model', 'TEST_MODEL_API_KEY', 'TEST_MODEL_API_URL');

  it('requires both the key and the URL env vars to be considered configured', () => {
    expect(provider.isConfigured()).toBe(false);

    process.env.TEST_MODEL_API_KEY = 'fake-key';
    expect(provider.isConfigured()).toBe(false); // URL still missing

    process.env.TEST_MODEL_API_URL = 'https://example.com/asr';
    expect(provider.isConfigured()).toBe(true);
  });

  it('transcribe() fails honestly without a network call when unconfigured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await provider.transcribe('base64audio', 'audio/wav', 'en');

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transcribe() surfaces a malformed/error HTTP response as a failure, not a crash', async () => {
    process.env.TEST_MODEL_API_KEY = 'fake-key';
    process.env.TEST_MODEL_API_URL = 'https://example.com/asr';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      })
    );

    const result = await provider.transcribe('base64audio', 'audio/wav', 'en');
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('transcribe() returns the real transcript on a successful call', async () => {
    process.env.TEST_MODEL_API_KEY = 'fake-key';
    process.env.TEST_MODEL_API_URL = 'https://example.com/asr';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ transcript: 'take two tablets daily' }),
      })
    );

    const result = await provider.transcribe('base64audio', 'audio/wav', 'en');
    expect(result.success).toBe(true);
    expect(result.transcript).toBe('take two tablets daily');
  });

  it('transcribe() fails honestly when the response has no transcript field, rather than fabricating one', async () => {
    process.env.TEST_MODEL_API_KEY = 'fake-key';
    process.env.TEST_MODEL_API_URL = 'https://example.com/asr';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'shape' }),
      })
    );

    const result = await provider.transcribe('base64audio', 'audio/wav', 'en');
    expect(result.success).toBe(false);
    expect(result.transcript).toBeUndefined();
  });
});
