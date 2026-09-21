/**
 * Text Normalization for Speech Recognition & African Language Evaluation
 * Follows standard ASR evaluation pipelines with awareness of African tonal orthographies.
 */

export interface NormalizationOptions {
  stripPunctuation?: boolean;
  toLowerCase?: boolean;
  normalizeWhitespace?: boolean;
  stripDiacritics?: boolean; // Useful for studying orthographic diacritic sensitivity
  removeFillers?: boolean;
}

const DEFAULT_OPTIONS: NormalizationOptions = {
  stripPunctuation: true,
  toLowerCase: true,
  normalizeWhitespace: true,
  stripDiacritics: false,
  removeFillers: false,
};

const COMMON_SPEECH_FILLERS = new Set([
  'um', 'uh', 'er', 'ah', 'like', 'you know', 'hmm', 'toh', 'shebi', 'kwanu'
]);

/**
 * Normalizes text for fair ASR transcript comparison
 */
export function normalizeTranscript(
  text: string,
  options: NormalizationOptions = {}
): string {
  if (!text) return '';

  const opts = { ...DEFAULT_OPTIONS, ...options };
  let normalized = text;

  // 1. Convert to lower case
  if (opts.toLowerCase) {
    normalized = normalized.toLowerCase();
  }

  // 2. Strip diacritics / tone marks if explicitly requested (e.g. to test orthographic variation)
  if (opts.stripDiacritics) {
    // Normalizes NFD and strips combining diacritical marks
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // 3. Strip standard punctuation while preserving within-word apostrophes for contractions if needed
  if (opts.stripPunctuation) {
    // Replace common dashes, hyphens, and em-dashes with spaces
    normalized = normalized.replace(/[-–—/]/g, ' ');
    // Strip punctuation marks
    normalized = normalized.replace(/[.,!?;:"'()\[\]{}«»""'’`]/g, '');
  }

  // 4. Optionally remove speech fillers
  if (opts.removeFillers) {
    const words = normalized.split(/\s+/);
    normalized = words.filter(w => !COMMON_SPEECH_FILLERS.has(w)).join(' ');
  }

  // 5. Normalize whitespace
  if (opts.normalizeWhitespace) {
    normalized = normalized.trim().replace(/\s+/g, ' ');
  }

  return normalized;
}

/**
 * Splits normalized text into word tokens
 */
export function tokenizeWords(text: string): string[] {
  const norm = normalizeTranscript(text);
  if (!norm) return [];
  return norm.split(/\s+/).filter(Boolean);
}

/**
 * Splits normalized text into character tokens (ignoring spaces)
 */
export function tokenizeChars(text: string): string[] {
  const norm = normalizeTranscript(text);
  if (!norm) return [];
  return Array.from(norm.replace(/\s+/g, ''));
}
