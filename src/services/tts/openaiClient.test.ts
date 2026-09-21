import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOpenAIKeys,
  isOpenAIConfigured,
  getOpenAIOrigin,
  isQuotaExceededError,
  isTimeoutError,
  withTimeout,
  openaiChatCompletion,
  openaiTranscribeAudio,
  checkOpenAIReachable,
  OpenAINotConfiguredError,
  OriginMisconfiguredError,
  ModelNotAvailableError,
  getActiveModels,
  __resetPathCacheForTests,
} from './openaiClient';

const KEY_ENV_VARS = [
  'OPEN_AI_KEY',
  'OPENAI_API_KEY',
  'SOPENAI_APIKEY',
  'TOPENAI_APIKEY',
  'FOPENAI_APIKEY',
  'GROQ_APIKEY',
  'GROKK_APIKEY',
  'GROK_APIKEY',
  'GROOK_APIKEY',
];
const OTHER_ENV_VARS = [
  'OPENAI_BASE_URL',
  'OPENAI_CHAT_PATH',
  'OPENAI_TRANSCRIBE_PATH',
  'OPENAI_SPEECH_PATH',
  'OPENAI_CALL_TIMEOUT_MS',
  'OPENAI_CHAT_MODEL',
  'OPENAI_TRANSCRIBE_MODEL',
  'OPENAI_SPEECH_MODEL',
];
const savedEnv: Record<string, string | undefined> = {};
for (const key of [...KEY_ENV_VARS, ...OTHER_ENV_VARS]) savedEnv[key] = process.env[key];

function clearKeys() {
  for (const key of KEY_ENV_VARS) delete process.env[key];
}

function clearOtherEnv() {
  for (const key of OTHER_ENV_VARS) delete process.env[key];
}

beforeEach(() => {
  clearKeys();
  clearOtherEnv();
  __resetPathCacheForTests();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('getOpenAIKeys / isOpenAIConfigured', () => {
  it('returns an empty list and reports not configured when nothing is set', () => {
    expect(getOpenAIKeys()).toEqual([]);
    expect(isOpenAIConfigured()).toBe(false);
  });

  it('returns configured keys in fallback order: primary, then S/T/F backups', () => {
    process.env.FOPENAI_APIKEY = 'fourth';
    process.env.OPEN_AI_KEY = 'first';
    process.env.TOPENAI_APIKEY = 'third';
    process.env.SOPENAI_APIKEY = 'second';

    expect(getOpenAIKeys()).toEqual(['first', 'second', 'third', 'fourth']);
    expect(isOpenAIConfigured()).toBe(true);
  });

  it('skips unset keys without leaving gaps', () => {
    process.env.OPEN_AI_KEY = 'first';
    process.env.FOPENAI_APIKEY = 'fourth';

    expect(getOpenAIKeys()).toEqual(['first', 'fourth']);
  });

  it('trims whitespace picked up from a pasted dashboard value', () => {
    process.env.OPEN_AI_KEY = '  first-key\n';
    expect(getOpenAIKeys()).toEqual(['first-key']);
  });

  it('de-duplicates the same value set under two different variable names', () => {
    process.env.OPEN_AI_KEY = 'same-key';
    process.env.OPENAI_API_KEY = 'same-key';
    expect(getOpenAIKeys()).toEqual(['same-key']);
  });

  it('includes Groq key variants after the OpenAI-named keys, in order, preferring GROQ_APIKEY first', () => {
    process.env.OPEN_AI_KEY = 'openai-key';
    process.env.GROOK_APIKEY = 'grook-key';
    process.env.GROKK_APIKEY = 'grokk-key';
    process.env.GROK_APIKEY = 'grok-key';
    process.env.GROQ_APIKEY = 'groq-key';

    expect(getOpenAIKeys()).toEqual(['openai-key', 'groq-key', 'grokk-key', 'grok-key', 'grook-key']);
  });

  it('works with only the correctly-spelled GROQ_APIKEY configured and no OpenAI-named key at all', () => {
    process.env.GROQ_APIKEY = 'groq-key';
    expect(getOpenAIKeys()).toEqual(['groq-key']);
    expect(isOpenAIConfigured()).toBe(true);
  });

  it('still recognizes the earlier misspelled Groq variants for backward compatibility', () => {
    process.env.GROK_APIKEY = 'grok-key';
    expect(getOpenAIKeys()).toEqual(['grok-key']);
    expect(isOpenAIConfigured()).toBe(true);
  });
});

describe('getOpenAIOrigin', () => {
  it('defaults to the real OpenAI API — never a hostname owned by this project', () => {
    const origin = getOpenAIOrigin();
    expect(origin).toBe('https://api.openai.com');
    expect(origin).not.toMatch(/sabiline/i);
    expect(origin).not.toMatch(/onrender\.com/i);
  });

  it('is overridable via OPENAI_BASE_URL, with a trailing /v1 and slashes normalized away', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1/';
    expect(getOpenAIOrigin()).toBe('https://example.com');
  });

  it('does not double up /v1 when OPENAI_BASE_URL is set without it', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com';
    expect(getOpenAIOrigin()).toBe('https://example.com');
  });
});

describe('isQuotaExceededError', () => {
  it('recognizes a 429 rate-limit error', () => {
    expect(isQuotaExceededError(new Error('OpenAI chat completion failed (429): rate_limit exceeded'))).toBe(true);
  });

  it('does not flag an unrelated error as quota exceeded', () => {
    expect(isQuotaExceededError(new Error('OpenAI chat completion failed (500): internal error'))).toBe(false);
  });
});

describe('withTimeout / isTimeoutError', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the wrapped value when it settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 8000)).resolves.toBe('ok');
  });

  it('rejects with a timeout error once the deadline passes', async () => {
    const hanging = new Promise(() => {});
    const promise = withTimeout(hanging, 8000);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(8000);
    await expect(promise).rejects.toThrow(/took too long/);
    const err = await promise.catch((e) => e);
    expect(isTimeoutError(err)).toBe(true);
  });
});

describe('openaiChatCompletion key fallback (path already resolved)', () => {
  // These tests care about key rotation, not path discovery, so they prime
  // the path cache first with a plain successful call — mirroring how a
  // warm serverless container behaves after its first real request.
  async function primeResolvedPath() {
    process.env.OPEN_AI_KEY = 'priming-key';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      url === 'https://api.openai.com/v1/chat/completions'
        ? new Response(JSON.stringify({ choices: [{ message: { content: 'primed' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('not found', { status: 404 })
    );
    await openaiChatCompletion([{ role: 'user', content: 'prime' }]);
    vi.restoreAllMocks();
  }

  it('throws OpenAINotConfiguredError when no key is set', async () => {
    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(OpenAINotConfiguredError);
  });

  it('tries the next key on a 401/429 on the resolved path and succeeds', async () => {
    await primeResolvedPath();
    process.env.OPEN_AI_KEY = 'bad-key';
    process.env.SOPENAI_APIKEY = 'good-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const auth = init.headers.Authorization;
      if (auth === 'Bearer bad-key') {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not try another key on a non-key-level failure (e.g. 500)', async () => {
    await primeResolvedPath();
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.SOPENAI_APIKEY = 'another-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('server error', { status: 500 }));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the last error once every configured key has failed', async () => {
    await primeResolvedPath();
    process.env.OPEN_AI_KEY = 'bad-1';
    process.env.SOPENAI_APIKEY = 'bad-2';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429/);
  });
});

describe('openaiChatCompletion endpoint path discovery', () => {
  it('resolves on the very first candidate against the real default origin, probing nothing else', async () => {
    process.env.OPEN_AI_KEY = 'a-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi there' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hi there');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.anything());
  });

  it('probes candidates sequentially, stops at the first success, and caches the working path', async () => {
    process.env.OPEN_AI_KEY = 'a-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === 'https://api.openai.com/chat/completions') {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hi there' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('<pre>Cannot POST</pre>', { status: 404 });
    });

    const first = await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(first).toBe('hi there');
    // Sequential: /v1/chat/completions 404s, /chat/completions succeeds —
    // exactly 2 calls, never all 4 candidates fired at once.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call should go straight to the cached path — no repeat probing.
    fetchMock.mockClear();
    const second = await openaiChatCompletion([{ role: 'user', content: 'hi again' }]);
    expect(second).toBe('hi there');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/chat/completions', expect.anything());
  });

  it('resolves the path from a key-level failure (401) when no candidate succeeds outright, and does not re-try that same key on it', async () => {
    process.env.OPEN_AI_KEY = 'bad-key';
    process.env.SOPENAI_APIKEY = 'good-key';

    // /chat/completions exists (it 401s, meaning the route is real but this
    // key isn't valid on it) — every other candidate 404s outright.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      if (url !== 'https://api.openai.com/chat/completions') {
        return new Response('<pre>Cannot POST</pre>', { status: 404 });
      }
      const auth = init.headers.Authorization;
      return auth === 'Bearer bad-key'
        ? new Response('unauthorized', { status: 401 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'second key worked' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    });

    const result = await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('second key worked');
    // 4 sequential discovery calls (one per candidate, all with bad-key) +
    // 1 fallback call with good-key — bad-key is never retried against the
    // now-known path, since discovery already proved it fails there.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('surfaces a clear error when every candidate path 404s', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<pre>Cannot POST</pre>', { status: 404 }));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no matching endpoint found/);
  });

  it('skips discovery entirely when OPENAI_CHAT_PATH is set', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_CHAT_PATH = '/weird/custom/route';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'custom route worked' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('custom route worked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/weird/custom/route', expect.anything());
  });
});

describe('a 404 about the MODEL, not the path (the Groq decommissioning case)', () => {
  // Groq's chat URL is https://api.groq.com/openai/v1/chat/completions — the
  // first candidate this client tries. When that exact URL 404s because the
  // model was retired, the old code blamed the path: it burned all four
  // candidates, cached correct paths as ruled out, and told the user to set
  // OPENAI_CHAT_PATH — the one setting that could never fix it.
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  function decommissioned() {
    return new Response(
      JSON.stringify({
        error: {
          message: 'The model `llama-3.3-70b-versatile` has been decommissioned and is no longer supported.',
          type: 'invalid_request_error',
          code: 'model_decommissioned',
        },
      }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    );
  }

  it('never guesses at other paths — a rejected model says nothing about the URL', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url));
      return decommissioned();
    });

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      ModelNotAvailableError
    );

    // The chat URL, plus the /v1/models lookup that tries to recover. The
    // three other path candidates are never touched.
    expect(urls).toEqual([GROQ_URL, 'https://api.groq.com/openai/v1/models']);
    expect(urls.some((u) => /\/chat\/completions/.test(u) && u !== GROQ_URL)).toBe(false);
  });

  it('reports honestly when the provider offers no usable replacement', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/v1/models')) {
        // Only speech models — nothing here can hold a conversation.
        return new Response(JSON.stringify({ data: [{ id: 'whisper-large-v3' }, { id: 'playai-tts' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return decommissioned();
    });

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /The provider lists: whisper-large-v3, playai-tts/
    );
  });

  it('names the model setting without forwarding the raw provider payload to the caller', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => decommissioned());

    // Still actionable: the operator is told exactly which setting to change.
    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /rejected the configured model.*Set OPENAI_CHAT_MODEL/s
    );

    // But the verbatim body no longer reaches the caller. This string is
    // surfaced to a patient, and the raw body carried the origin hostname.
    // The full body is logged server-side instead, so nothing is lost.
    const err = await openaiChatCompletion([{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err.message).not.toMatch(/api\.groq\.com/);
    expect(err.message).not.toMatch(/model_decommissioned/);
    expect(err.message).not.toMatch(/has been decommissioned/);
    // And never points at the path override, which cannot fix a model problem.
    expect(err.message).not.toMatch(/OPENAI_CHAT_PATH/);
  });

  it('does not poison the path cache, so fixing the model works without a redeploy', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.OPENAI_CHAT_MODEL = 'llama-3.3-70b-versatile';
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      urls.push(String(url));
      if (JSON.parse(init.body).model === 'llama-3.3-70b-versatile') return decommissioned();
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      ModelNotAvailableError
    );

    // Correct the model only — the path was never the problem, and must not
    // have been cached as ruled out.
    process.env.OPENAI_CHAT_MODEL = 'llama-3.1-8b-instant';
    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    expect(urls.filter((u) => u.endsWith('/chat/completions'))).toEqual([GROQ_URL, GROQ_URL]);
  });

  it('still treats a genuinely unknown URL as a path problem', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === 'https://api.openai.com/chat/completions') {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hi there' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: { message: 'Unknown request URL: POST /v1/chat/completions', code: 'unknown_url' } }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    });

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).resolves.toBe('hi there');
    expect(fetchMock).toHaveBeenCalledTimes(2); // moved on to the next candidate
  });

  it('quotes the last 404 body when every path really is wrong', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('<pre>Cannot POST /v1/chat/completions</pre>', { status: 404 })
    );

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /Last response:.*Cannot POST/s
    );
  });
});

describe('automatic recovery when the configured model is retired', () => {
  // The real incident: Groq decommissioned llama-3.3-70b-versatile on
  // 2026-08-16 and every intake turn failed until a human edited an env var
  // and redeployed. The client now asks the provider what it serves and
  // carries on.
  const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
  const DEAD = 'llama-3.3-70b-versatile';

  function groq(modelIds: string[], onChat?: (model: string) => void) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      const u = String(url);
      if (u === GROQ_MODELS) {
        return new Response(JSON.stringify({ data: modelIds.map((id) => ({ id })) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const model = JSON.parse(init.body).model;
      onChat?.(model);
      if (!modelIds.includes(model)) {
        return new Response(
          JSON.stringify({
            error: { message: `The model \`${model}\` has been decommissioned.`, code: 'model_decommissioned' },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  }

  beforeEach(() => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    process.env.OPENAI_CHAT_MODEL = DEAD;
  });

  it('substitutes a live model and completes the call, instead of failing the turn', async () => {
    const tried: string[] = [];
    groq(['openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'whisper-large-v3'], (m) => tried.push(m));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    expect(tried).toEqual([DEAD, 'openai/gpt-oss-120b']);
  });

  it('remembers the substitution, so later turns cost no extra round trips', async () => {
    const tried: string[] = [];
    const fetchMock = groq(['openai/gpt-oss-120b'], (m) => tried.push(m));

    await openaiChatCompletion([{ role: 'user', content: 'one' }]);
    const afterFirst = fetchMock.mock.calls.length;
    await openaiChatCompletion([{ role: 'user', content: 'two' }]);

    expect(tried).toEqual([DEAD, 'openai/gpt-oss-120b', 'openai/gpt-oss-120b']);
    expect(fetchMock.mock.calls.length).toBe(afterFirst + 1); // no second /v1/models
  });

  it('reports which model is really in use, and that it was not the operator\'s choice', async () => {
    groq(['openai/gpt-oss-120b']);
    expect(getActiveModels().chat).toEqual({ model: DEAD, autoSelected: false });

    await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(getActiveModels().chat).toEqual({ model: 'openai/gpt-oss-120b', autoSelected: true });
  });

  it('never substitutes a speech model into a chat call', async () => {
    const tried: string[] = [];
    groq(['whisper-large-v3', 'playai-tts', 'llama-3.1-8b-instant'], (m) => tried.push(m));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    expect(tried[1]).toBe('llama-3.1-8b-instant');
  });

  it('picks whisper for transcription, never a chat model', async () => {
    process.env.OPENAI_TRANSCRIBE_MODEL = 'whisper-1'; // not a Groq model
    const tried: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      const u = String(url);
      if (u.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3-turbo' }, { id: 'whisper-large-v3' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      const model = (init.body as FormData).get('model');
      tried.push(String(model));
      if (model !== 'whisper-large-v3') {
        return new Response(
          JSON.stringify({ error: { message: `The model \`${model}\` does not exist`, code: 'model_not_found' } }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ text: 'my stomach hurts' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await openaiTranscribeAudio('AAAA', 'audio/wav', { languageHint: 'en' });
    expect(result.transcript).toBe('my stomach hurts');
    // large-v3 over turbo: clinical intake favours accuracy over latency.
    expect(tried).toEqual(['whisper-1', 'whisper-large-v3']);
  });

  it('does not loop: a rejected replacement is reported, not re-substituted', async () => {
    const tried: string[] = [];
    // The list advertises a model the chat route then rejects anyway.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      tried.push(JSON.parse(init.body).model);
      return new Response(
        JSON.stringify({ error: { message: 'The model does not exist', code: 'model_not_found' } }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    });

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      ModelNotAvailableError
    );
    expect(tried).toEqual([DEAD, 'openai/gpt-oss-120b']); // exactly one substitution
  });

  it('still works against a provider whose model names it has never seen', async () => {
    const tried: string[] = [];
    groq(['some-vendor/unfamiliar-model-v9'], (m) => tried.push(m));

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).resolves.toBe('ok');
    expect(tried[1]).toBe('some-vendor/unfamiliar-model-v9');
  });
});

describe('provider-specific model overrides (e.g. for a Groq origin)', () => {
  it('sends the default gpt-4o-mini model when OPENAI_CHAT_MODEL is unset', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    let sentBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init: any) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(sentBody.model).toBe('gpt-4o-mini');
  });

  it('sends OPENAI_CHAT_MODEL when set, e.g. for a Groq origin', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_CHAT_MODEL = 'llama-3.3-70b-versatile';
    let sentBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init: any) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await openaiChatCompletion([{ role: 'user', content: 'hi' }]);
    expect(sentBody.model).toBe('llama-3.3-70b-versatile');
  });

  it('an explicit per-call model option still wins over OPENAI_CHAT_MODEL', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_CHAT_MODEL = 'llama-3.3-70b-versatile';
    let sentBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init: any) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await openaiChatCompletion([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' });
    expect(sentBody.model).toBe('gpt-4o');
  });
});

describe('OriginMisconfiguredError', () => {
  it('is raised, with an actionable message, when the configured origin returns a 200 HTML page instead of JSON', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://not-really-openai.example.com';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<!doctype html><html><body>Welcome to My App</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(OriginMisconfiguredError);
    await expect(openaiChatCompletion([{ role: 'user', content: 'hi' }])).rejects.toThrow(/OPENAI_BASE_URL/);
  });

  it('is raised for transcription too, and is never mistaken for a 404 path-not-found', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://not-really-openai.example.com';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><html><body>Welcome</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(openaiTranscribeAudio('YQ==', 'audio/wav')).rejects.toBeInstanceOf(OriginMisconfiguredError);
  });
});

describe('provider-neutral error labels', () => {
  // These strings reach the patient, so they must state the failure honestly
  // WITHOUT naming this deployment's infrastructure. A live 429 used to hand
  // the caller the internal provider hostname, the account's organization id
  // and its exact token quota, all inside the provider's verbatim body.

  it('never names the configured origin in a chat-completion failure', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 500 }));

    const err = await openaiChatCompletion([{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err.message).not.toMatch(/api\.groq\.com/);
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(err.message).not.toMatch(/^OpenAI /);
    // Still honest and actionable about what actually happened.
    expect(err.message).toMatch(/Chat completion/);
  });

  it('never names the configured origin in a transcription failure', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('server error', { status: 500 }));

    const err = await openaiTranscribeAudio('YQ==', 'audio/wav').catch((e) => e);
    expect(err.message).not.toMatch(/api\.groq\.com/);
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(err.message).toMatch(/Audio transcription/);
  });

  it('never leaks an account id or quota counter from the live rate-limit payload', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              'Rate limit reached for model `openai/gpt-oss-120b` in organization ' +
              '`org_01m2n51ct6exgakhddbdtvfzja` on tokens per minute (TPM): Limit 8000, Used 7573. ' +
              'Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing',
            type: 'tokens',
            code: 'rate_limit_exceeded',
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    );

    const err = await openaiChatCompletion([{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err.message).not.toMatch(/org_/);
    expect(err.message).not.toMatch(/01m2n51ct6exgakhddbdtvfzja/);
    expect(err.message).not.toMatch(/groq/i);
    expect(err.message).not.toMatch(/https?:\/\//);
    expect(err.message).not.toMatch(/console\./i);
    expect(err.message).not.toMatch(/\b8000\b/);
    expect(err.message).toMatch(/rate-limiting/i);
  });
});

describe('checkOpenAIReachable', () => {
  it('reports not reachable, without a network call, when no key is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await checkOpenAIReachable();
    expect(result.reachable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports reachable when the origin answers a real JSON response', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const result = await checkOpenAIReachable();
    expect(result.reachable).toBe(true);
  });

  it('reports not reachable, with an actionable message, when the origin answers HTML', async () => {
    process.env.OPEN_AI_KEY = 'a-key';
    process.env.OPENAI_BASE_URL = 'https://not-really-openai.example.com';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );

    const result = await checkOpenAIReachable();
    expect(result.reachable).toBe(false);
    expect(result.message).toMatch(/OPENAI_BASE_URL/);
  });
});
