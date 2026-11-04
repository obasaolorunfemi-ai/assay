// How much two people agree when they label the same items: raw agreement and Cohen's kappa (agreement beyond what chance alone would give).
export function agreement(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('two label lists of the same, non-zero length are needed');
  return a.filter((x, i) => x === b[i]).length / a.length;
}
export function cohenKappa(a, b) {
  const po = agreement(a, b);
  const labels = [...new Set([...a, ...b])];
  const pe = labels.reduce((sum, l) => sum + (a.filter((x) => x === l).length / a.length) * (b.filter((x) => x === l).length / b.length), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
/** The Wilson score interval for a proportion: the honest range around "k of n", better behaved than the textbook one at small n and near 0 or 1. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
