import { tokenizeChars, normalizeTranscript, NormalizationOptions } from './normalization';

export interface CERCalculationResult {
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceCharCount: number;
  hypothesisCharCount: number;
}

/**
 * Calculates Character Error Rate (CER) using Levenshtein edit distance on characters.
 * CER = (S + D + I) / N
 */
export function calculateCER(
  referenceText: string,
  hypothesisText: string,
  options?: NormalizationOptions
): CERCalculationResult {
  const normRef = normalizeTranscript(referenceText, options);
  const normHyp = normalizeTranscript(hypothesisText, options);

  const refChars = tokenizeChars(normRef);
  const hypChars = tokenizeChars(normHyp);

  const n = refChars.length;
  const m = hypChars.length;

  if (n === 0) {
    return {
      cer: m === 0 ? 0 : 1.0,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceCharCount: 0,
      hypothesisCharCount: m,
    };
  }

  // Memory-optimized Levenshtein for characters
  let prevRow = Array.from({ length: m + 1 }, (_, j) => j);
  let currRow = new Array(m + 1).fill(0);

  // For detailed counts
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refChars[i - 1] === hypChars[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack for counts
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refChars[i - 1] === hypChars[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions++;
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      insertions++;
      j--;
    } else {
      break;
    }
  }

  const cer = (substitutions + deletions + insertions) / n;

  return {
    cer: Number(cer.toFixed(4)),
    substitutions,
    deletions,
    insertions,
    referenceCharCount: n,
    hypothesisCharCount: m,
  };
}
