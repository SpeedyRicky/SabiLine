import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Modality: { AUDIO: 'AUDIO' },
}));

import { synthesizeReferenceAudio } from './geminiSynthesize';

const savedKey = process.env.GEMINI_API_KEY;
const FAKE_PCM_BASE64 = Buffer.from(new Int16Array([1000, -1000, 2000, -2000]).buffer).toString('base64');

function mockSuccessOnce() {
  mockGenerateContent.mockResolvedValueOnce({
    candidates: [{ content: { parts: [{ inlineData: { data: FAKE_PCM_BASE64 } }] } }],
  });
}

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe('synthesizeReferenceAudio without a configured key', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('fails honestly without a network call when GEMINI_API_KEY is unset', async () => {
    const result = await synthesizeReferenceAudio('take two tablets daily', 'en');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
    expect(result.audioBase64).toBeUndefined();
  });
});

describe('synthesizeReferenceAudio with a configured key', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    mockGenerateContent.mockReset();
  });

  it('calls Gemini once and reuses the real result for an identical (text, language) pair', async () => {
    mockSuccessOnce();

    const first = await synthesizeReferenceAudio('cache test phrase one', 'en');
    expect(first.success).toBe(true);
    expect(first.fromCache).toBeUndefined();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const second = await synthesizeReferenceAudio('cache test phrase one', 'en');
    expect(second.success).toBe(true);
    expect(second.fromCache).toBe(true);
    expect(second.audioBase64).toBe(first.audioBase64);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('synthesizes separately when the language differs, even for identical text', async () => {
    mockSuccessOnce();
    mockSuccessOnce();

    await synthesizeReferenceAudio('cache test phrase two', 'en');
    await synthesizeReferenceAudio('cache test phrase two', 'fr');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('flags a 429 RESOURCE_EXHAUSTED failure as quotaExceeded, and does not cache the failure', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));

    const result = await synthesizeReferenceAudio('cache test phrase three', 'en');
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);

    mockSuccessOnce();
    const retry = await synthesizeReferenceAudio('cache test phrase three', 'en');
    expect(retry.success).toBe(true);
    expect(retry.fromCache).toBeUndefined();
  });
});
