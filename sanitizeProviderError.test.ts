import { describe, it, expect } from 'vitest';
import {
  classifyProviderError,
  scrubProviderDetail,
  sanitizeProviderError,
} from './sanitizeProviderError';

// The actual string a patient was shown. Every assertion below exists to make
// sure nothing like it can ever reach a caller-facing response again.
const LIVE_GROQ_RATE_LIMIT =
  'Chat completion (https://api.groq.com/openai) failed (429): ' +
  '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization ' +
  '`org_01m2n51ct6exgakhddbdtvfzja` service tier `on_demand` on tokens per minute (TPM): ' +
  'Limit 8000, Used 7573, Requested 636. Please try again in 1.5675s. Need more tokens? ' +
  'Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens",' +
  '"code":"rate_limit_exceeded"}}';

const LIVE_MODEL_REJECTION =
  'Speech synthesis (https://api.groq.com/openai): the configured model was rejected — ' +
  '{"error":{"message":"The model `tts-1` does not exist or you do not have access to it.",' +
  '"type":"invalid_request_error"}}';

describe('classifyProviderError', () => {
  it('recognizes a rate limit', () => {
    expect(classifyProviderError(LIVE_GROQ_RATE_LIMIT)).toBe('rate-limit');
  });

  it('classifies a rate limit as a rate limit even though it names a model', () => {
    // Regression guard: the real message contains both "model `...`" and
    // "rate_limit_exceeded". Ordering decides which wins, and reporting a
    // throttle as a model problem sends the operator to the wrong setting.
    expect(LIVE_GROQ_RATE_LIMIT).toMatch(/model/);
    expect(classifyProviderError(LIVE_GROQ_RATE_LIMIT)).toBe('rate-limit');
  });

  it('recognizes a rejected model', () => {
    expect(classifyProviderError(LIVE_MODEL_REJECTION)).toBe('model');
  });

  it('recognizes auth, quota, not-found and unavailable failures', () => {
    expect(classifyProviderError('{"error":{"code":"invalid_api_key"}}')).toBe('auth');
    expect(classifyProviderError('HTTP 401 Unauthorized')).toBe('auth');
    expect(classifyProviderError('insufficient_quota: you exceeded your current quota')).toBe('quota');
    expect(classifyProviderError('unknown_url: no route matches')).toBe('not-found');
    expect(classifyProviderError('HTTP 404 page not found')).toBe('not-found');
    expect(classifyProviderError('503 Service Unavailable')).toBe('unavailable');
  });

  it('falls back to unknown for anything unrecognized', () => {
    expect(classifyProviderError('something entirely unexpected')).toBe('unknown');
  });
});

describe('scrubProviderDetail', () => {
  it('replaces URLs', () => {
    const out = scrubProviderDetail('failed calling https://api.groq.com/openai/v1/chat');
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).toContain('the provider endpoint');
  });

  it('replaces organization identifiers', () => {
    const out = scrubProviderDetail('in organization `org_01m2n51ct6exgakhddbdtvfzja`');
    expect(out).not.toMatch(/org_01m2n51ct6exgakhddbdtvfzja/);
    expect(out).toContain('the account');
  });

  it('removes an embedded JSON error body wholesale', () => {
    const out = scrubProviderDetail('failed: {"error":{"message":"boom","id":"x"}}');
    expect(out).not.toContain('{');
    expect(out).not.toContain('boom');
  });

  it('redacts Bearer tokens and key-shaped strings', () => {
    expect(scrubProviderDetail('Authorization: Bearer sk-abcdef1234567890')).not.toMatch(/sk-abcdef/);
    expect(scrubProviderDetail('key sk-proj-abcdefghijklmnop')).not.toMatch(/sk-proj-abcdefghijklmnop/);
  });

  it('redacts email addresses', () => {
    expect(scrubProviderDetail('contact support@example.com for help')).not.toMatch(/support@example\.com/);
  });

  it('redacts long opaque identifiers that are neither a word nor a model name', () => {
    const out = scrubProviderDetail('account 01m2n51ct6exgakhddbdtvfzjaREF12345');
    expect(out).not.toContain('01m2n51ct6exgakhddbdtvfzjaREF12345');
  });

  it('leaves ordinary actionable prose untouched', () => {
    const out = scrubProviderDetail('invalid text voice accent,yoruba not supported for language yo');
    expect(out).toBe('invalid text voice accent,yoruba not supported for language yo');
  });
});

describe('sanitizeProviderError', () => {
  it('leaks no hostname, account id, quota counter or billing link for the live rate-limit payload', () => {
    const message = sanitizeProviderError(LIVE_GROQ_RATE_LIMIT, { subject: 'Chat completion (HTTP 429)' });

    expect(message).not.toMatch(/groq/i);
    expect(message).not.toMatch(/https?:\/\//i);
    expect(message).not.toMatch(/console\./i);
    expect(message).not.toMatch(/org_/i);
    expect(message).not.toMatch(/01m2n51ct6exgakhddbdtvfzja/);
    expect(message).not.toMatch(/\b8000\b/);
    expect(message).not.toMatch(/\b7573\b/);
    expect(message).not.toMatch(/\bgpt-oss-120b\b/);
  });

  it('still tells the patient something honest and actionable about the rate limit', () => {
    const message = sanitizeProviderError(LIVE_GROQ_RATE_LIMIT, { subject: 'Chat completion' });
    expect(message).toMatch(/rate-limiting/i);
  });

  it('leaks no hostname for the live model-rejection payload', () => {
    const message = sanitizeProviderError(LIVE_MODEL_REJECTION, { subject: 'Speech synthesis' });
    expect(message).not.toMatch(/groq/i);
    expect(message).not.toMatch(/https?:\/\//i);
    expect(message).toMatch(/rejected the configured model/i);
  });

  it('never returns an empty string, so a caller can always surface something', () => {
    for (const raw of ['', undefined, '{not json}', '   ']) {
      expect(sanitizeProviderError(raw).length).toBeGreaterThan(0);
    }
  });

  it('keeps the actionable part of a plain-text provider message', () => {
    const message = sanitizeProviderError(
      'invalid text voice accent,"swahili" not supported for language en',
      { subject: 'Sahara speech synthesis' }
    );
    expect(message).toContain('swahili');
    expect(message).toContain('not supported for language en');
  });

  it('scrubs a URL that only appears in the subject line', () => {
    const message = sanitizeProviderError('boom', {
      subject: 'Chat completion (https://api.groq.com/openai)',
    });
    expect(message).not.toMatch(/groq/i);
    expect(message).not.toMatch(/https?:\/\//i);
  });

  it('can drop provider detail entirely when asked', () => {
    const message = sanitizeProviderError(LIVE_GROQ_RATE_LIMIT, {
      subject: 'Chat completion',
      maxDetailChars: 0,
    });
    expect(message).not.toMatch(/provider detail/i);
  });

  it('truncates very long detail instead of forwarding a wall of text', () => {
    const message = sanitizeProviderError('x'.repeat(50) + ' word '.repeat(200), {
      subject: 'Chat completion',
      maxDetailChars: 40,
    });
    expect(message.length).toBeLessThan(200);
  });
});
