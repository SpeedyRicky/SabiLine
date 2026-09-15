import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTwilioConfigured, placeReminderCall } from './twilioReminder';

const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;
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

describe('isTwilioConfigured', () => {
  it('reports not configured when no Twilio env vars are set', () => {
    expect(isTwilioConfigured()).toBe(false);
  });

  it('reports not configured when only some Twilio env vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    expect(isTwilioConfigured()).toBe(false);
  });

  it('reports configured once all three Twilio env vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';
    expect(isTwilioConfigured()).toBe(true);
  });
});

describe('placeReminderCall', () => {
  it('fails honestly without a network call when unconfigured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await placeReminderCall('+15551234567', 'Reminder message');

    expect(result.success).toBe(false);
    expect(result.notConfigured).toBe(true);
    expect(result.error).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('places a real call once configured, and returns the call SID', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'CAfakecallsid' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await placeReminderCall('+15551234567', 'Your appointment is tomorrow at 10:30am.');

    expect(result.success).toBe(true);
    expect(result.callSid).toBe('CAfakecallsid');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACfake/Calls.json');
    expect(init.headers.Authorization).toMatch(/^Basic /);
    const body = init.body as URLSearchParams;
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('From')).toBe('+15550000000');
    expect(body.get('Twiml')).toContain('Your appointment is tomorrow at 10:30am.');
  });

  it('XML-escapes the message so it cannot break out of the <Say> element', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'CAfakecallsid' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await placeReminderCall('+15551234567', 'Reminder & <urgent> "now"');

    const [, init] = fetchSpy.mock.calls[0];
    const twiml = (init.body as URLSearchParams).get('Twiml') || '';
    expect(twiml).toContain('Reminder &amp; &lt;urgent&gt; &quot;now&quot;');
    expect(twiml).not.toContain('<urgent>');
  });

  it('surfaces a Twilio error response as a failure, not a crash', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'The number +1555 is not a valid phone number.' }),
      })
    );

    const result = await placeReminderCall('+1555', 'Reminder message');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid phone number/);
  });

  it('fails honestly when the response has no call SID, rather than fabricating one', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'shape' }),
      })
    );

    const result = await placeReminderCall('+15551234567', 'Reminder message');

    expect(result.success).toBe(false);
    expect(result.callSid).toBeUndefined();
  });
});
