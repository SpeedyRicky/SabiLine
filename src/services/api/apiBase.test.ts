import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiUrl, isNativeShell, describeApiBase, ApiBaseNotConfiguredError } from './apiBase';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Stands in for the `window.Capacitor` object the native shell injects. */
function nativeShell(protocol = 'capacitor:') {
  vi.stubGlobal('window', {
    Capacitor: { isNativePlatform: () => true },
    location: { protocol },
  });
}

function browser() {
  vi.stubGlobal('window', { location: { protocol: 'https:' } });
}

describe('isNativeShell', () => {
  it('is false in a plain browser', () => {
    browser();
    expect(isNativeShell()).toBe(false);
  });

  it('is true when Capacitor says so', () => {
    nativeShell();
    expect(isNativeShell()).toBe(true);
  });

  it('falls back to the capacitor: protocol for shells without isNativePlatform', () => {
    vi.stubGlobal('window', { Capacitor: {}, location: { protocol: 'capacitor:' } });
    expect(isNativeShell()).toBe(true);
  });

  it('is false during SSR or a test with no window at all', () => {
    vi.stubGlobal('window', undefined);
    expect(isNativeShell()).toBe(false);
  });
});

describe('apiUrl', () => {
  it('keeps web requests relative, exactly as before', () => {
    browser();
    expect(apiUrl('/api/intake/converse')).toBe('/api/intake/converse');
    expect(apiUrl('/api/providers/status')).toBe('/api/providers/status');
  });

  it('makes them absolute when a base URL is configured', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://sabiline-six.vercel.app');
    browser();
    expect(apiUrl('/api/tts/generate')).toBe('https://sabiline-six.vercel.app/api/tts/generate');
  });

  it('does not double the slash when the base URL has a trailing one', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://sabiline-six.vercel.app/');
    nativeShell();
    expect(apiUrl('/api/tts/generate')).toBe('https://sabiline-six.vercel.app/api/tts/generate');
  });

  it('ignores a blank or whitespace-only value rather than emitting "//api/..."', () => {
    vi.stubEnv('VITE_API_BASE_URL', '   ');
    browser();
    expect(apiUrl('/api/translate')).toBe('/api/translate');
  });

  it('refuses to build a doomed relative URL inside a packaged app', () => {
    nativeShell();
    expect(() => apiUrl('/api/intake/converse')).toThrow(ApiBaseNotConfiguredError);
    // The message has to name the fix — a 404 at the call site would read as
    // "the server is down" when the app was never pointed at one.
    expect(() => apiUrl('/api/intake/converse')).toThrow(/VITE_API_BASE_URL/);
  });

  it('also refuses on Android, where the shell origin is plain http://localhost', () => {
    vi.stubGlobal('window', {
      Capacitor: { isNativePlatform: () => true },
      location: { protocol: 'http:' },
    });
    expect(() => apiUrl('/api/intake/converse')).toThrow(ApiBaseNotConfiguredError);
  });
});

describe('describeApiBase', () => {
  it('reports same-origin for the web build', () => {
    browser();
    expect(describeApiBase()).toBe('(same origin)');
  });

  it('reports the configured origin when there is one', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://sabiline-six.vercel.app');
    browser();
    expect(describeApiBase()).toBe('https://sabiline-six.vercel.app');
  });

  it('flags an unconfigured native build instead of claiming same-origin', () => {
    nativeShell();
    expect(describeApiBase()).toMatch(/unconfigured/);
  });
});
