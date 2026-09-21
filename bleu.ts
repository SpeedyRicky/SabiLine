import { normalizeTranscript } from './normalization';

/**
 * Computes sentence-level BLEU score (BLEU-1 to BLEU-4 with brevity penalty)
 * for evaluating African healthcare translation outputs.
 */
export function calculateSentenceBLEU(
  reference: string,
  hypothesis: string,
  maxN: number = 4
): number {
  const refTokens = normalizeTranscript(reference).split(/\s+/).filter(Boolean);
  const hypTokens = normalizeTranscript(hypothesis).split(/\s+/).filter(Boolean);

  if (hypTokens.length === 0 || refTokens.length === 0) return 0;

  // Brevity penalty
  const c = hypTokens.length;
  const r = refTokens.length;
  const bp = c > r ? 1.0 : Math.exp(1 - r / c);

  let logSum = 0;
  let validGramOrders = 0;

  for (let n = 1; n <= maxN; n++) {
    if (hypTokens.length < n) break;

    const hypNgrams: Record<string, number> = {};
    for (let i = 0; i <= hypTokens.length - n; i++) {
      const gram = hypTokens.slice(i, i + n).join(' ');
      hypNgrams[gram] = (hypNgrams[gram] || 0) + 1;
    }

    const refNgrams: Record<string, number> = {};
    for (let i = 0; i <= refTokens.length - n; i++) {
      const gram = refTokens.slice(i, i + n).join(' ');
      refNgrams[gram] = (refNgrams[gram] || 0) + 1;
    }

    let matches = 0;
    let totalHypNgrams = 0;

    for (const [gram, count] of Object.entries(hypNgrams)) {
      totalHypNgrams += count;
      const refCount = refNgrams[gram] || 0;
      matches += Math.min(count, refCount);
    }

    // Smoothing for 0 matches in higher n-grams
    const precision = totalHypNgrams === 0 ? 0 : (matches + 0.1) / (totalHypNgrams + 0.1);
    logSum += (1 / maxN) * Math.log(precision);
    validGramOrders++;
  }

  if (validGramOrders === 0) return 0;

  const bleu = bp * Math.exp(logSum);
  return Number(Math.min(1.0, Math.max(0, bleu)).toFixed(4));
}

/**
 * Calculates chrF (character n-gram F-score)
 * Widely recommended for morphologically rich African languages (Hausa, Igbo, Yoruba)
 * because it is robust to affixation, compounding, and tone orthography.
 */
export function calculateChrF(
  reference: string,
  hypothesis: string,
  n: number = 6,
  beta: number = 2.0
): number {
  const refNorm = normalizeTranscript(reference).replace(/\s+/g, '');
  const hypNorm = normalizeTranscript(hypothesis).replace(/\s+/g, '');

  if (!refNorm || !hypNorm) return 0;

  let totalPrecision = 0;
  let totalRecall = 0;
  let validOrders = 0;

  for (let order = 1; order <= n; order++) {
    if (hypNorm.length < order || refNorm.length < order) break;

    const hypGrams: Record<string, number> = {};
    for (let i = 0; i <= hypNorm.length - order; i++) {
      const gram = hypNorm.substring(i, i + order);
      hypGrams[gram] = (hypGrams[gram] || 0) + 1;
    }

    const refGrams: Record<string, number> = {};
    for (let i = 0; i <= refNorm.length - order; i++) {
      const gram = refNorm.substring(i, i + order);
      refGrams[gram] = (refGrams[gram] || 0) + 1;
    }

    let matches = 0;
    let hypTotal = 0;
    let refTotal = 0;

    for (const [gram, count] of Object.entries(hypGrams)) {
      hypTotal += count;
      const rCount = refGrams[gram] || 0;
      matches += Math.min(count, rCount);
    }
    for (const count of Object.values(refGrams)) {
      refTotal += count;
    }

    const p = hypTotal > 0 ? matches / hypTotal : 0;
    const r = refTotal > 0 ? matches / refTotal : 0;

    totalPrecision += p;
    totalRecall += r;
    validOrders++;
  }

  if (validOrders === 0) return 0;

  const avgP = totalPrecision / validOrders;
  const avgR = totalRecall / validOrders;

  const betaSq = beta * beta;
  const denominator = betaSq * avgP + avgR;
  if (denominator === 0) return 0;

  const chrf = ((1 + betaSq) * avgP * avgR) / denominator;
  return Number(chrf.toFixed(4));
}
