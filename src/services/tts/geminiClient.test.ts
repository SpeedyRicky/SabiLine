import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation((config: { apiKey: string }) => ({ apiKey: config.apiKey })),
}));

import { getGeminiClient, isQuotaExceededError, withGeminiRetry } from './geminiClient';

const savedKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe('getGeminiClient', () => {
  it('returns null when GEMINI_API_KEY is unset', () => {
    delete process.env.GEMINI_API_KEY;
    expect(getGeminiClient()).toBeNull();
  });

  it('returns null when GEMINI_API_KEY is only whitespace', () => {
    process.env.GEMINI_API_KEY = '   \n';
    expect(getGeminiClient()).toBeNull();
  });

  it('strips a trailing newline/space picked up when a key is pasted into a dashboard field', async () => {
    // Fresh module instance so the previous test's cached client isn't reused.
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'fake-key-for-test\n';
    const { getGeminiClient: freshGetGeminiClient } = await import('./geminiClient');
    const client = freshGetGeminiClient() as unknown as { apiKey: string };
    expect(client.apiKey).toBe('fake-key-for-test');
  });
});

describe('isQuotaExceededError', () => {
  it('recognizes a 429 RESOURCE_EXHAUSTED error', () => {
    expect(isQuotaExceededError(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'))).toBe(true);
  });

  it('does not flag an unrelated error as quota exceeded', () => {
    expect(isQuotaExceededError(new Error('503 UNAVAILABLE: model overloaded'))).toBe(false);
  });
});

describe('withGeminiRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withGeminiRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 503 UNAVAILABLE failure and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}'))
      .mockResolvedValueOnce('recovered');
    const promise = withGeminiRetry(fn);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 429 quota-exceeded failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    await expect(withGeminiRetry(fn)).rejects.toThrow(/RESOURCE_EXHAUSTED/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries on a persistent transient failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 UNAVAILABLE'));
    const promise = withGeminiRetry(fn, 2);
    // Prevent an unhandled-rejection warning while timers advance the retry loop.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/UNAVAILABLE/);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
