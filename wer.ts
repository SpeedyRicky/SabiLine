import { tokenizeWords, normalizeTranscript, NormalizationOptions } from './normalization';

export interface WERCalculationResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWordCount: number;
  hypothesisWordCount: number;
  normalizedReference: string;
  normalizedHypothesis: string;
  alignedTokens: Array<{
    ref: string | null;
    hyp: string | null;
    type: 'correct' | 'substitution' | 'deletion' | 'insertion';
  }>;
}

/**
 * Calculates Word Error Rate (WER) using Wagner-Fischer dynamic programming algorithm.
 * WER = (S + D + I) / N
 * where:
 * S = Substitutions
 * D = Deletions
 * I = Insertions
 * N = Reference word count
 */
export function calculateWER(
  referenceText: string,
  hypothesisText: string,
  options?: NormalizationOptions
): WERCalculationResult {
  const normRef = normalizeTranscript(referenceText, options);
  const normHyp = normalizeTranscript(hypothesisText, options);

  const refTokens = tokenizeWords(normRef);
  const hypTokens = tokenizeWords(normHyp);

  const n = refTokens.length;
  const m = hypTokens.length;

  if (n === 0) {
    return {
      wer: m === 0 ? 0 : 1.0,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceWordCount: 0,
      hypothesisWordCount: m,
      normalizedReference: normRef,
      normalizedHypothesis: normHyp,
      alignedTokens: hypTokens.map(h => ({ ref: null, hyp: h, type: 'insertion' as const })),
    };
  }

  // Cost matrix & operation tracking for backtracking
  // dp[i][j] holds min edit distance
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const ops: string[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(''));

  for (let i = 0; i <= n; i++) {
    dp[i][0] = i;
    ops[i][0] = 'D'; // deletion from ref
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j;
    ops[0][j] = 'I'; // insertion to hyp
  }
  ops[0][0] = 'C';

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refTokens[i - 1] === hypTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        ops[i][j] = 'C'; // correct match
      } else {
        const subCost = dp[i - 1][j - 1] + 1;
        const delCost = dp[i - 1][j] + 1;
        const insCost = dp[i][j - 1] + 1;

        if (subCost <= delCost && subCost <= insCost) {
          dp[i][j] = subCost;
          ops[i][j] = 'S';
        } else if (delCost <= insCost) {
          dp[i][j] = delCost;
          ops[i][j] = 'D';
        } else {
          dp[i][j] = insCost;
          ops[i][j] = 'I';
        }
      }
    }
  }

  // Backtracking alignment
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  const alignedTokens: Array<{
    ref: string | null;
    hyp: string | null;
    type: 'correct' | 'substitution' | 'deletion' | 'insertion';
  }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && (ops[i][j] === 'C' || ops[i][j] === 'S')) {
      if (ops[i][j] === 'S') {
        substitutions++;
        alignedTokens.unshift({ ref: refTokens[i - 1], hyp: hypTokens[j - 1], type: 'substitution' });
      } else {
        alignedTokens.unshift({ ref: refTokens[i - 1], hyp: hypTokens[j - 1], type: 'correct' });
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || ops[i][j] === 'D')) {
      deletions++;
      alignedTokens.unshift({ ref: refTokens[i - 1], hyp: null, type: 'deletion' });
      i--;
    } else if (j > 0 && (i === 0 || ops[i][j] === 'I')) {
      insertions++;
      alignedTokens.unshift({ ref: null, hyp: hypTokens[j - 1], type: 'insertion' });
      j--;
    } else {
      break;
    }
  }

  const wer = (substitutions + deletions + insertions) / n;

  return {
    wer: Number(wer.toFixed(4)),
    substitutions,
    deletions,
    insertions,
    referenceWordCount: n,
    hypothesisWordCount: m,
    normalizedReference: normRef,
    normalizedHypothesis: normHyp,
    alignedTokens,
  };
}
