import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockChatCompletion = vi.fn();
const mockTranscribeAudio = vi.fn();
let configured = true;

vi.mock('../tts/openaiClient', async () => {
  const actual = await vi.importActual<typeof import('../tts/openaiClient')>('../tts/openaiClient');
  return {
    ...actual,
    isOpenAIConfigured: () => configured,
    openaiChatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
    openaiTranscribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
  };
});

import {
  detectLanguageAndTranscribe,
  detectLanguageFromText,
  transcribeWithLanguageHint,
  isLowEvidenceForLanguageSwitch,
  resolveLanguageSwitch,
  parseConfidence,
  LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD,
  LANGUAGE_MARKERS,
} from './detectLanguage';

afterEach(() => {
  configured = true;
  mockChatCompletion.mockReset();
  mockTranscribeAudio.mockReset();
});

describe('detectLanguageAndTranscribe without a configured key', () => {
  beforeEach(() => {
    configured = false;
  });

  it('fails honestly without a network call when no OpenAI key is set', async () => {
    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OpenAI/);
    expect(result.transcript).toBeUndefined();
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });
});

describe('detectLanguageAndTranscribe with a configured key', () => {
  it('transcribes via Whisper, then classifies the resulting text', async () => {
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: 'Orúkọ mi ni Ngozi', detectedLanguageRaw: 'yoruba' });
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'yo' }));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('yo');
    expect(result.transcript).toBe('Orúkọ mi ni Ngozi');
  });

  it('falls back to English when the classifier returns an unsupported language code', async () => {
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: 'Bonjour' });
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'fr' }));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('en');
    expect(result.transcript).toBe('Bonjour');
  });

  it('fails honestly rather than fabricating a transcript when Whisper returns nothing', async () => {
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: '' });

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.transcript).toBeUndefined();
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('still returns the transcript (defaulting to English) if classification itself fails', async () => {
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: 'Sunana Amina' });
    mockChatCompletion.mockRejectedValueOnce(new Error('classification failed'));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('en');
    expect(result.transcript).toBe('Sunana Amina');
  });

  it('flags a 429 rate-limit failure from transcription as quotaExceeded', async () => {
    mockTranscribeAudio.mockRejectedValueOnce(new Error('OpenAI transcription failed (429): rate_limit exceeded'));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });

  it('recognizes Fulfulde as a detectable language', async () => {
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: 'Jam waali' });
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ful' }));

    const result = await detectLanguageAndTranscribe('base64audio', 'audio/wav');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('ful');
  });

  it('flags timedOut and fails fast when transcription hangs past the platform-safe budget', async () => {
    vi.useFakeTimers();
    try {
      mockTranscribeAudio.mockReturnValueOnce(new Promise(() => {})); // never resolves
      const resultPromise = detectLanguageAndTranscribe('base64audio', 'audio/wav');
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isLowEvidenceForLanguageSwitch', () => {
  it('treats bare acknowledgements as no evidence of a language switch', () => {
    for (const filler of ['okay', 'OK', 'yes', 'No.', 'yeah', 'thanks', 'Hmm', 'abeg']) {
      expect(isLowEvidenceForLanguageSwitch(filler), filler).toBe(true);
    }
  });

  it('treats bare numbers (an age, a phone number) as no evidence', () => {
    expect(isLowEvidenceForLanguageSwitch('34')).toBe(true);
    expect(isLowEvidenceForLanguageSwitch('08012345678')).toBe(true);
    expect(isLowEvidenceForLanguageSwitch('  +234 801 234 5678 ')).toBe(true);
  });

  it('treats an empty or whitespace-only turn as no evidence', () => {
    expect(isLowEvidenceForLanguageSwitch('')).toBe(true);
    expect(isLowEvidenceForLanguageSwitch('   ')).toBe(true);
  });

  it('treats a real sentence as genuine evidence, in any supported language', () => {
    expect(isLowEvidenceForLanguageSwitch('Mo ni iba')).toBe(false);
    expect(isLowEvidenceForLanguageSwitch('Ina jin zazzabi')).toBe(false);
    expect(isLowEvidenceForLanguageSwitch('I dey feel hot')).toBe(false);
    expect(isLowEvidenceForLanguageSwitch('I have had a fever since yesterday')).toBe(false);
  });

  it('treats a single long word as evidence — it can still carry language signal', () => {
    expect(isLowEvidenceForLanguageSwitch('zazzabi')).toBe(false);
  });
});

describe('transcribeWithLanguageHint', () => {
  beforeEach(() => {
    configured = false;
  });

  it('fails honestly without a network call when no OpenAI key is set', async () => {
    const result = await transcribeWithLanguageHint('base64audio', 'audio/wav', 'yo');
    expect(result.success).toBe(false);
    expect(result.notConfigured).toBe(true);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it('passes the language hint and a clinic vocabulary prompt through to transcription, and echoes the hint back rather than reclassifying', async () => {
    configured = true;
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: 'Mo ni iba' });

    const result = await transcribeWithLanguageHint('base64audio', 'audio/wav', 'yo');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('yo');
    expect(result.transcript).toBe('Mo ni iba');
    expect(mockChatCompletion).not.toHaveBeenCalled();

    const [, , opts] = mockTranscribeAudio.mock.calls[0];
    expect(opts.languageHint).toBe('yo');
    expect(typeof opts.prompt).toBe('string');
  });

  it('fails honestly rather than fabricating a transcript when Whisper returns nothing', async () => {
    configured = true;
    mockTranscribeAudio.mockResolvedValueOnce({ transcript: '' });

    const result = await transcribeWithLanguageHint('base64audio', 'audio/wav', 'ha');
    expect(result.success).toBe(false);
  });
});

describe('detectLanguageFromText without a configured key', () => {
  beforeEach(() => {
    configured = false;
  });

  it('fails honestly without a network call when no OpenAI key is set', async () => {
    const result = await detectLanguageFromText('Hello, my name is Amina');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OpenAI/);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });
});

describe('detectLanguageFromText with a configured key', () => {
  it('returns the detected language for typed text', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ha' }));

    const result = await detectLanguageFromText('Sunana Amina');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('ha');
  });

  it('recognizes Fulfulde from typed text', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ful' }));

    const result = await detectLanguageFromText('Jam waali');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('ful');
  });

  it('falls back to English when the model returns an unsupported language code', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'fr' }));

    const result = await detectLanguageFromText('Bonjour');
    expect(result.success).toBe(true);
    expect(result.languageCode).toBe('en');
  });

  it('flags a 429 rate-limit failure as quotaExceeded', async () => {
    mockChatCompletion.mockRejectedValueOnce(new Error('OpenAI chat completion failed (429): rate_limit exceeded'));

    const result = await detectLanguageFromText('hello');
    expect(result.success).toBe(false);
    expect(result.quotaExceeded).toBe(true);
  });

  it('includes the Pidgin disambiguation markers in the prompt', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'pcm' }));

    await detectLanguageFromText('I dey feel pain for my belle');
    const messages = mockChatCompletion.mock.calls[0][0];
    expect(messages[0].content).toMatch(/dey/);
    expect(messages[0].content).toMatch(/Nigerian Pidgin/);
  });

  it('anchors on the previous language when given one, without forcing that result', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'en' }));

    const result = await detectLanguageFromText('Actually can we continue in English', 'yo');
    expect(result.languageCode).toBe('en');
    const messages = mockChatCompletion.mock.calls[0][0];
    expect(messages[0].content).toMatch(/Yoruba/);
  });

  it('reports the confidence the model returned', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ha', confidence: 0.91 }));

    const result = await detectLanguageFromText('Ina jin zazzabi');
    expect(result.confidence).toBe(0.91);
  });

  it('accepts a confidence sent as a numeric string', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ig', confidence: '0.8' }));

    const result = await detectLanguageFromText('Ahu na-agbu m');
    expect(result.confidence).toBe(0.8);
  });

  it('treats a missing confidence as not-stated rather than as zero', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'yo' }));

    const result = await detectLanguageFromText('Mo ni iba');
    expect(result.success).toBe(true);
    expect(result.confidence).toBeUndefined();
  });

  it('carries discriminating markers for every supported language, not only Pidgin', async () => {
    mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ languageCode: 'ha' }));

    await detectLanguageFromText('Ina jin zazzabi');
    const prompt = mockChatCompletion.mock.calls[0][0][0].content;

    // The short-utterance failure this guards against: "Ina jinin jiki" was
    // classified as Yoruba. Hausa's own markers must actually be present.
    expect(prompt).toMatch(/ciwon kai/);
    expect(prompt).toMatch(/zazzabi/);
    // Yoruba must spell out that orififo means headache, not cough.
    expect(prompt).toMatch(/orififo/);
    expect(prompt).toMatch(/headache, NOT cough/);
    // Igbo and Fulfulde markers, so neither language is detectable-by-name only.
    expect(prompt).toMatch(/ahụ ọkụ/);
    expect(prompt).toMatch(/hoore/);
    // And the confidence ask that the switch guard depends on.
    expect(prompt).toMatch(/confidence/);
  });
});

describe('parseConfidence', () => {
  it('passes through a real number in range', () => {
    expect(parseConfidence(0.75)).toBe(0.75);
    expect(parseConfidence(0)).toBe(0);
    expect(parseConfidence(1)).toBe(1);
  });

  it('clamps a number outside 0..1', () => {
    expect(parseConfidence(1.7)).toBe(1);
    expect(parseConfidence(-0.4)).toBe(0);
  });

  it('accepts a numeric string', () => {
    expect(parseConfidence('0.9')).toBe(0.9);
  });

  it('treats anything unparseable as absent, never as zero', () => {
    for (const raw of [undefined, null, 'high', {}, [], NaN, Infinity]) {
      expect(parseConfidence(raw), String(raw)).toBeUndefined();
    }
  });
});

describe('resolveLanguageSwitch', () => {
  it('keeps the anchor when there is no candidate at all', () => {
    expect(resolveLanguageSwitch('ha', undefined, undefined, false)).toEqual({
      language: 'ha',
      switched: false,
      reason: 'no-candidate',
    });
  });

  it('ignores an unsupported candidate rather than adopting it', () => {
    const decision = resolveLanguageSwitch('ha', 'fr' as never, 0.99, false);
    expect(decision.language).toBe('ha');
    expect(decision.switched).toBe(false);
  });

  it('keeps the anchor when the candidate is the same language', () => {
    expect(resolveLanguageSwitch('ig', 'ig', 0.9, false).reason).toBe('same-language');
  });

  it('refuses to switch on a low-evidence turn even at high confidence', () => {
    const decision = resolveLanguageSwitch('yo', 'en', 0.99, true);
    expect(decision.language).toBe('yo');
    expect(decision.reason).toBe('low-evidence');
  });

  it('refuses to switch on a low-confidence guess', () => {
    const decision = resolveLanguageSwitch('yo', 'ha', 0.3, false);
    expect(decision.language).toBe('yo');
    expect(decision.reason).toBe('low-confidence');
  });

  it('switches on a confident, evidenced candidate', () => {
    const decision = resolveLanguageSwitch('yo', 'ha', 0.9, false);
    expect(decision.language).toBe('ha');
    expect(decision.switched).toBe(true);
    expect(decision.reason).toBe('switched');
  });

  it('does not block a switch when the model omitted confidence entirely', () => {
    // Blocking here would disable mid-call switching for any model that
    // ignores the confidence field — the opposite of the requirement.
    expect(resolveLanguageSwitch('en', 'ig', undefined, false).language).toBe('ig');
  });

  it('treats exactly the threshold as confident enough', () => {
    expect(resolveLanguageSwitch('en', 'ful', LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD, false).language).toBe('ful');
    expect(resolveLanguageSwitch('en', 'ful', LANGUAGE_SWITCH_CONFIDENCE_THRESHOLD - 0.01, false).language).toBe('en');
  });

  it('covers every language the intake path can encounter', () => {
    for (const code of ['en', 'pcm', 'yo', 'ig', 'ha', 'ful'] as const) {
      expect(LANGUAGE_MARKERS[code], code).toBeTruthy();
      expect(resolveLanguageSwitch('en', code, 0.95, false).language).toBe(code);
    }
  });
});
