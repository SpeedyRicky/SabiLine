import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isSaharaConfigured,
  synthesizeWithSahara,
  genderFromVoiceId,
  SaharaNotConfiguredError,
  SaharaLanguageUnsupportedError,
  __resetSaharaLimitCache,
} from './saharaTts';

const savedKey = process.env.SAHARA_API_KEY;
const savedTimeout = process.env.SAHARA_TTS_TIMEOUT_MS;

beforeEach(() => {
  process.env.SAHARA_API_KEY = 'test-sahara-key';
  delete process.env.SAHARA_TTS_TIMEOUT_MS;
  __resetSaharaLimitCache();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.SAHARA_API_KEY;
  else process.env.SAHARA_API_KEY = savedKey;
  if (savedTimeout === undefined) delete process.env.SAHARA_TTS_TIMEOUT_MS;
  else process.env.SAHARA_TTS_TIMEOUT_MS = savedTimeout;
  vi.restoreAllMocks();
});

const GENERATE = 'https://infer.voice.intron.io/tts/v1/generate';
const AUDIO_URL = 'https://cdn.example.com/audio.wav';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function generated(audio_path = AUDIO_URL) {
  return {
    data: { audio_duration_in_seconds: 3, audio_path, processing_status: 'TTS_TEXT_AUDIO_GENERATED' },
    message: 'text status found',
    status: 'Ok',
  };
}

/** A real (if tiny) WAV, so the joining path has something valid to parse. */
function wav(pcm: string): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(48000, 4);
  fmt.writeUInt32LE(96000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const data = Buffer.from(pcm);
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
  const body = Buffer.concat([
    Buffer.from('WAVE'), Buffer.from('fmt '), u32(16), fmt,
    Buffer.from('data'), u32(data.length), data,
  ]);
  return Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]);
}

describe('isSaharaConfigured / genderFromVoiceId', () => {
  it('reports configured only when a key is actually set', () => {
    expect(isSaharaConfigured()).toBe(true);
    delete process.env.SAHARA_API_KEY;
    expect(isSaharaConfigured()).toBe(false);
  });

  it('reads gender out of this app\'s voice ids, defaulting to female', () => {
    expect(genderFromVoiceId('sahara-yo-male-1')).toBe('male');
    expect(genderFromVoiceId('sahara-yo-female-1')).toBe('female');
    expect(genderFromVoiceId(undefined)).toBe('female');
  });
});

describe('synthesizeWithSahara', () => {
  it('throws without a network call when no key is configured', async () => {
    delete process.env.SAHARA_API_KEY;
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(synthesizeWithSahara('Bawo ni', 'yo')).rejects.toBeInstanceOf(SaharaNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a language it has no voice for, rather than substituting one', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(synthesizeWithSahara('Jam waali', 'ful')).rejects.toBeInstanceOf(SaharaLanguageUnsupportedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('speaks Nigerian Pidgin with the Nigerian English voice rather than refusing it', async () => {
    // Pidgin is English-based and spoken with Nigerian phonetics, so it shares
    // the `en` voice instead of failing and dropping to a device voice.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) return jsonResponse(generated());
      return new Response(wav('i-dey-come'), { status: 200 });
    });

    const result = await synthesizeWithSahara('I dey come', 'pcm');
    expect(result.audioBase64.length).toBeGreaterThan(0);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.voice_language).toBe('en');
    expect(sent.voice_accent).toBe('nigerian');
  });

  it('generates in one call and downloads the audio it is pointed at', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      calls.push(String(url));
      if (String(url) === GENERATE) return jsonResponse(generated());
      return new Response(wav('bawo-ni-audio'), { status: 200 });
    });

    const result = await synthesizeWithSahara('Bawo ni', 'yo', 'sahara-yo-female-1');

    expect(calls).toEqual([GENERATE, AUDIO_URL]);
    expect(result.mimeType).toBe('audio/wav');
    expect(Buffer.from(result.audioBase64, 'base64').toString()).toContain('bawo-ni-audio');
    expect(result.durationSec).toBe(3);
  });

  it('sends the language, accent and gender Sahara expects', async () => {
    let sentBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url) === GENERATE) {
        sentBody = JSON.parse(init.body);
        return jsonResponse(generated());
      }
      return new Response(wav('a'), { status: 200 });
    });

    await synthesizeWithSahara('Sannu', 'ha', 'sahara-ha-male-1');
    expect(sentBody).toEqual({
      text: 'Sannu',
      voice_language: 'ha',
      voice_accent: 'hausa',
      voice_gender: 'male',
    });
  });

  it('quotes Sahara\'s own message and the exact triple it sent when rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ data: {}, message: 'invalid text voice accent,yoruba not supported for language yo', status: 'Error' }, 400)
    );

    await expect(synthesizeWithSahara('Bawo ni', 'yo')).rejects.toThrow(
      /voice_accent="yoruba".*invalid text voice accent,yoruba not supported/s
    );
  });

  it('polls out the text_id when generation exceeds Sahara\'s synchronous window', async () => {
    const calls: string[] = [];
    let poll = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u === GENERATE) {
        return jsonResponse({ data: { text_id: 'job-123' }, message: 'timeout', status: 'Error' }, 503);
      }
      if (u.includes('/tts/v1/status/')) {
        poll += 1;
        // Still processing — note it ALREADY carries an audio_path, which must
        // not be mistaken for the audio being ready.
        if (poll < 3) {
          return jsonResponse({ data: { audio_path: AUDIO_URL, processing_status: 'TTS_TEXT_AUDIO_PROCESSING' }, status: 'Ok' });
        }
        return jsonResponse(generated());
      }
      expect(poll).toBeGreaterThanOrEqual(3); // download only after GENERATED
      return new Response(wav('late-audio'), { status: 200 });
    });

    const result = await synthesizeWithSahara('Bawo ni', 'yo', undefined, { intervalMs: 1 });

    expect(calls[1]).toBe('https://infer.voice.intron.io/tts/v1/status/job-123');
    expect(calls[calls.length - 1]).toBe(AUDIO_URL);
    expect(Buffer.from(result.audioBase64, 'base64').toString()).toContain('late-audio');
  });

  it('reports honestly when a 503 carries no text_id to recover with', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: {}, status: 'Error' }, 503));
    await expect(synthesizeWithSahara('Bawo ni', 'yo')).rejects.toThrow(/no text_id to poll/);
  });

  it('surfaces a failed job rather than hanging or returning silence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) return jsonResponse({ data: { text_id: 'j' } }, 503);
      return jsonResponse({ data: { processing_status: 'TTS_TEXT_AUDIO_PROCESSING_FAILED' }, status: 'Ok' });
    });

    await expect(synthesizeWithSahara('Bawo ni', 'yo', undefined, { intervalMs: 1 })).rejects.toThrow(/failed during processing/);
  });

  it('gives up with a clear timeout message instead of polling forever', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) return jsonResponse({ data: { text_id: 'j' } }, 503);
      return jsonResponse({ data: { audio_path: AUDIO_URL, processing_status: 'TTS_TEXT_AUDIO_PROCESSING' }, status: 'Ok' });
    });

    await expect(
      synthesizeWithSahara('Bawo ni', 'yo', undefined, { intervalMs: 1, timeoutMs: 30 })
    ).rejects.toThrow(/did not finish generating audio/);
  });

  it('never downloads audio for a job that only claims to be done', async () => {
    let downloaded = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) {
        return jsonResponse({ data: { audio_path: AUDIO_URL, processing_status: 'TTS_TEXT_AUDIO_QUEUED' }, status: 'Ok' });
      }
      downloaded = true;
      return new Response(wav('x'), { status: 200 });
    });

    await expect(synthesizeWithSahara('Bawo ni', 'yo')).rejects.toThrow(/unfinished job/);
    expect(downloaded).toBe(false);
  });

  it('waits out a 429 and retries, honouring Retry-After', async () => {
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) {
        attempts += 1;
        if (attempts === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
        return jsonResponse(generated());
      }
      return new Response(wav('audio'), { status: 200 });
    });

    const result = await synthesizeWithSahara('Bawo ni', 'yo', undefined, { intervalMs: 1 });
    expect(attempts).toBe(2);
    expect(result.audioBase64.length).toBeGreaterThan(0);
  });

  it('reports honestly when the rate limit is still exhausted after retrying', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
    );

    await expect(synthesizeWithSahara('Bawo ni', 'yo', undefined, { intervalMs: 1 })).rejects.toThrow(/rate limit/i);
  });

  it('does not treat an empty audio download as success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url) === GENERATE) return jsonResponse(generated());
      return new Response(Buffer.from(''), { status: 200 });
    });

    await expect(synthesizeWithSahara('Bawo ni', 'yo')).rejects.toThrow(/empty audio file/);
  });
});

describe('the character limit Sahara actually enforces', () => {
  // Sahara's own docs disagree with themselves: /generate says 4096 characters,
  // its 400 sample says 100. These cover the behaviour either way.
  const longText =
    'Bawo ni, mo fe beere ibeere die si yin nipa ilera yin loni. ' +
    'Nje e le so fun mi ibi ti irora naa wa? E se pupo fun suuru yin.';

  function mockSahara(maxChars: number | null) {
    const texts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url) === GENERATE) {
        const body = JSON.parse(init.body);
        if (maxChars !== null && body.text.length > maxChars) {
          return jsonResponse(
            { data: {}, message: `tts text character count greater than the max limit of ${maxChars} characters`, status: 'Error' },
            400
          );
        }
        texts.push(body.text);
        return jsonResponse(generated(`https://cdn.example.com/${texts.length}.wav`));
      }
      return new Response(wav(`[${String(url).match(/(\d+)\.wav/)?.[1]}]`), { status: 200 });
    });
    return texts;
  }

  it('sends a long reply whole when Sahara accepts it', async () => {
    const texts = mockSahara(null);
    await synthesizeWithSahara(longText, 'yo');
    expect(texts).toEqual([longText]);
  });

  it('learns the real limit from the rejection, then splits and joins the audio', async () => {
    const texts = mockSahara(100);
    const result = await synthesizeWithSahara(longText, 'yo');

    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(100);
    // Every word survives the split — nothing is silently truncated.
    expect(texts.join(' ').replace(/\s+/g, ' ')).toBe(longText);
    // And the pieces come back as one continuous clip, in order.
    const joined = Buffer.from(result.audioBase64, 'base64').toString();
    expect(joined).toContain('[1][2]');
    expect(result.durationSec).toBe(3 * texts.length);
  });

  it('remembers the limit so later replies are not re-rejected', async () => {
    let rejections = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url) === GENERATE) {
        if (JSON.parse(init.body).text.length > 100) {
          rejections += 1;
          return jsonResponse({ data: {}, message: 'tts text character count greater than the max limit of 100 characters', status: 'Error' }, 400);
        }
        return jsonResponse(generated());
      }
      return new Response(wav('a'), { status: 200 });
    });

    await synthesizeWithSahara(longText, 'yo');
    await synthesizeWithSahara(longText, 'yo');
    expect(rejections).toBe(1); // only the very first call paid for the lesson
  });
});
