import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

import { detectLanguageAndTranscribe } from './detectLanguage';

const savedKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

describe('detectLanguageAndTranscribe without a configured key', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('fails honestly without a network call when GEMINI_API_KEY is unset', async () => {
    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
    expect(result.transcript).toBeUndefined();
  });
});

describe('detectLanguageAndTranscribe with a configured key', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    mockGenerateContent.mockReset();
  });

  it('returns the detected language and transcript on success', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ languageCode: 'yo', transcript: 'Orúkọ mi ni Ngozi' }),
    });

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('yo');
    expect(result.transcript).toBe('Orúkọ mi ni Ngozi');
  });

  it('falls back to English when the model returns an unsupported language code', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ languageCode: 'fr', transcript: 'Bonjour' }),
    });

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('en');
    expect(result.transcript).toBe('Bonjour');
  });

  it('fails honestly rather than fabricating a transcript when the response is empty', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ languageCode: 'en', transcript: '' }),
    });

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.transcript).toBeUndefined();
  });

  it('flags a 429 RESOURCE_EXHAUSTED failure as quotaExceeded', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });
});
