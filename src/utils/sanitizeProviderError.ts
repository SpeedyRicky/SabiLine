// Server-only. Scrubs provider infrastructure detail out of an error before
// it can reach a patient.
//
// Why this exists: a live 429 from the configured AI origin was surfaced
// verbatim into the caller-facing JSON, and a patient saw the internal
// provider hostname, the account's organization id, the account's exact
// token quota and a link to the provider's billing console. None of that is
// the patient's business, and an organization id is an identifier that
// should never leave the deployment.
//
// Two layers, deliberately:
//
//   1. classifyProviderError() maps the failure to one honest, actionable
//      category ("the provider is rate-limiting right now") so the patient
//      still gets something they can act on.
//   2. scrubProviderDetail() is a mechanical scrub applied to whatever text
//      remains, so even an unrecognised error cannot smuggle a URL, an
//      account id or a key through. The scrub is the safety net, not the
//      main mechanism — a category with no detail is still a good message.
//
// The full raw error is NOT discarded: callers log it with console.error so
// debugging is unaffected. Only the client-facing string is scrubbed.

/** Anything that looks like a URL. Covers http(s) and the console/billing
 *  links providers like to append. */
const URL_RE = /https?:\/\/[^\s"'`,)\]}]+/gi;
/** Provider account identifiers: `org_01m2n51ct6exgakhddbdtvfzja`, `org-abc123`. */
const ORG_ID_RE = /\borg[-_][A-Za-z0-9]{4,}\b/gi;
/** API keys that may have been echoed back in an error. */
const SECRET_RE = /\b(?:sk|pk|rk|gsk)[-_][A-Za-z0-9_-]{8,}\b/gi;
/** `Authorization: Bearer <key>` fragments. */
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Email addresses (provider support addresses, account owner). */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A JSON error blob — where the origin URL, org id and quota numbers live. */
const JSON_BODY_RE = /\{[\s\S]*\}/g;
/** `Limit 8000, Used 7573, Requested 636` style internal quota counters. */
const QUOTA_COUNTER_RE = /\b(?:limit|used|requested|remaining|available|quota)\b\s*[:=]?\s*[\d,]{2,}/gi;
/** A long opaque run of characters that is more likely a credential or id
 *  than prose. Kept conservative (24+ chars with no spaces) so ordinary
 *  words and model names are never touched. */
const LONG_OPAQUE_RE = /\b[A-Za-z0-9_-]{24,}\b/g;

/** Removals safe to apply to ANY string, including one this app composes
 *  itself out of real data: a hostname, an account id, a credential. */
const INFRASTRUCTURE_REPLACEMENTS: Array<[RegExp, string]> = [
  [URL_RE, 'the provider endpoint'],
  [ORG_ID_RE, 'the account'],
  [SECRET_RE, '[redacted]'],
  [BEARER_RE, 'Bearer [redacted]'],
  [EMAIL_RE, '[redacted]'],
];

/** The above, plus removals that only make sense against a raw provider error
 *  body — a whole JSON blob, quota counters, opaque token-shaped runs. These
 *  are deliberately too blunt for a list of real model ids, which legitimately
 *  contain long hyphenated names that the opaque-run rule would eat. */
const PROVIDER_BODY_REPLACEMENTS: Array<[RegExp, string]> = [
  [JSON_BODY_RE, ' '],
  [QUOTA_COUNTER_RE, 'quota details withheld'],
  [LONG_OPAQUE_RE, '[redacted]'],
];

function applyReplacements(text: string, replacements: Array<[RegExp, string]>): string {
  let out = text ?? '';
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Light scrub: strips infrastructure from a string that is otherwise
 * trustworthy. Used for messages this app builds itself from real data — most
 * concretely the list of model ids a provider actually serves, which is
 * exactly the detail an operator needs to fix a rejected-model error and
 * contains no hostnames or account ids to begin with.
 */
export function scrubInfrastructure(text: string): string {
  return applyReplacements(text, INFRASTRUCTURE_REPLACEMENTS);
}

export type ProviderErrorKind =
  | 'rate-limit'
  | 'quota'
  | 'auth'
  | 'model'
  | 'not-found'
  | 'unavailable'
  | 'unknown';

/**
 * Maps a raw provider error to one honest category.
 *
 * Order matters and is not arbitrary: a rate-limit message frequently *names
 * the model* ("Rate limit reached for model `x`..."), so the rate-limit test
 * has to run before the model test or a throttling error would be reported
 * as a model problem and send the operator to the wrong setting.
 */
export function classifyProviderError(raw: string): ProviderErrorKind {
  const text = raw.toLowerCase();

  if (/rate[ _-]?limit|too many requests|tokens per minute|\btpm\b|\brpm\b|\b429\b/.test(text)) {
    return 'rate-limit';
  }
  if (/insufficient_quota|exceeded your current quota|billing|credit balance|out of credit|payment/.test(text)) {
    return 'quota';
  }
  if (/invalid[ _]api[ _]key|incorrect api key|unauthorized|unauthenticated|\b401\b|\b403\b|authentication/.test(text)) {
    return 'auth';
  }
  if (
    /model_not_found|model_decommissioned|does not exist or you do not have access|no longer supported|decommissioned|unknown model|unsupported model|model.*not found|not a valid model/.test(
      text
    )
  ) {
    return 'model';
  }
  if (/unknown_url|unknown request url|does not exist|not found|\b404\b/.test(text)) {
    return 'not-found';
  }
  if (/\b50[234]\b|overloaded|temporarily unavailable|service unavailable|bad gateway|timed? ?out/.test(text)) {
    return 'unavailable';
  }
  return 'unknown';
}

/** The operator-facing explanation per category. No hostnames, no account
 *  ids, no quota counters — and each one names the setting to change when
 *  there is one. */
const KIND_MESSAGE: Record<ProviderErrorKind, string> = {
  'rate-limit':
    'the provider is rate-limiting this request. Please try again in a moment.',
  quota:
    'the provider account has no quota left right now. Check the account billing or configure a backup key.',
  auth:
    'the provider rejected the configured API key, so no request could be made.',
  model:
    'the provider rejected the configured model. Point the matching model environment variable at one this provider actually serves.',
  'not-found':
    'the provider does not expose this API route. Check the configured base URL and path overrides.',
  unavailable:
    'the provider is temporarily unavailable.',
  unknown:
    'the provider returned an error.',
};

/** Mechanically removes infrastructure detail from a string. Exported so a
 *  caller that already has a composed message can run it through as a final
 *  belt-and-braces pass. */
export function scrubProviderDetail(raw: string): string {
  // Infrastructure rules FIRST, and the order is load-bearing: an org id must
  // be recognised as an org id (-> "the account") before the opaque-run rule
  // sees it, or it would be swallowed as an anonymous redaction instead. The
  // provider-body pass then drops any JSON blob wholesale, which is what takes
  // the hostname and the quota counters with it.
  return applyReplacements(applyReplacements(raw, INFRASTRUCTURE_REPLACEMENTS), PROVIDER_BODY_REPLACEMENTS);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface SanitizeProviderErrorOptions {
  /** Leading label for the message, e.g. "Speech synthesis". Must not itself
   *  contain a hostname — callers pass a plain, provider-neutral label. */
  subject?: string;
  /** How much scrubbed provider detail to keep for debugging. 0 drops it. */
  maxDetailChars?: number;
}

/**
 * Builds the client-facing message for a failed provider call.
 *
 * Returns a category explanation plus a short, scrubbed excerpt of whatever
 * the provider said that did not look like infrastructure — so a wrong
 * accent string or a rejected parameter is still visible and fixable, while
 * the hostname, account id and quota counters are gone.
 */
export function sanitizeProviderError(
  raw: string | undefined,
  options: SanitizeProviderErrorOptions = {}
): string {
  const subject = options.subject?.trim() || 'The provider';
  const maxDetail = options.maxDetailChars ?? 180;
  const source = raw ?? '';

  const kind = classifyProviderError(source);
  const detail = maxDetail > 0 ? truncate(scrubProviderDetail(source), maxDetail) : '';

  const message = detail
    ? `${subject} failed: ${KIND_MESSAGE[kind]} Provider detail: ${detail}`
    : `${subject} failed: ${KIND_MESSAGE[kind]}`;

  // Final pass: nothing composed above may introduce a leak, even if a
  // future edit adds a field to the message. Cheap and unconditional.
  return scrubProviderDetail(message);
}
