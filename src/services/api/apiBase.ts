/**
 * Resolves where the frontend's `/api/...` calls actually go.
 *
 * On the web deployment the app and its API share an origin, so a relative
 * path is correct and stays correct — that is the behaviour this app has
 * always had, and nothing here changes it.
 *
 * Inside a packaged mobile app it is not. Capacitor serves the bundle from
 * its own origin (`capacitor://localhost` on iOS, `http://localhost` on
 * Android), and neither has a `/api` route: a relative call resolves to the
 * WebView itself and 404s, or worse, silently hits something else listening
 * on localhost. So a native build has to be told the real origin, which it
 * gets from VITE_API_BASE_URL at build time.
 *
 * When that is missing in a native shell this throws rather than letting the
 * request fail as a confusing 404 at the call site. A clinic intake app
 * mis-reporting "the server is down" when it was never pointed at a server
 * is exactly the class of misleading error this codebase keeps removing.
 */

/** Read per call rather than captured at module load: a value frozen at
 *  import time is invisible to tests and to anything that sets it late.
 *  Trailing slashes are stripped so `base + '/api/x'` never doubles up. */
function configuredBase(): string {
  return String(import.meta.env?.VITE_API_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

export class ApiBaseNotConfiguredError extends Error {
  constructor(path: string) {
    super(
      `This build has no VITE_API_BASE_URL, so "${path}" cannot be reached from a packaged app. ` +
        'Set VITE_API_BASE_URL to the deployment origin (e.g. https://sabiline-six.vercel.app) and rebuild.'
    );
    this.name = 'ApiBaseNotConfiguredError';
  }
}

/**
 * True when running inside a Capacitor native shell.
 *
 * Capacitor injects `window.Capacitor` before app code runs, so this is a
 * reliable signal and — unlike importing @capacitor/core — costs the web
 * bundle nothing. The protocol check is a fallback for older shells that
 * predate `isNativePlatform`.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (typeof capacitor?.isNativePlatform === 'function') return Boolean(capacitor.isNativePlatform());
  return window.location?.protocol === 'capacitor:';
}

/**
 * Turns an app-relative API path into the URL to actually request.
 *
 * `path` is always the same string the code used before (`/api/...`), so
 * call sites read the same and the web build emits byte-identical requests.
 */
export function apiUrl(path: string): string {
  const base = configuredBase();
  if (base) return `${base}${path}`;
  if (isNativeShell()) throw new ApiBaseNotConfiguredError(path);
  return path;
}

/** What this build will talk to — surfaced in diagnostics so a packaged app
 *  can be told apart from the web one without guessing. */
export function describeApiBase(): string {
  const base = configuredBase();
  if (base) return base;
  return isNativeShell() ? '(unconfigured — native build needs VITE_API_BASE_URL)' : '(same origin)';
}
