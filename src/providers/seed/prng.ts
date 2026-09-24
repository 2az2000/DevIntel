/**
 * Deterministic pseudo-random numbers.
 *
 * `Math.random()` is unusable here: the whole point of the seed dataset is that
 * it is byte-identical on every machine and every run, so tests can assert
 * exact scores instead of ranges. Every number in the dataset comes from one of
 * these generators, and every generator is seeded from a value the caller
 * controls.
 *
 * mulberry32 — 32-bit state, high quality for this purpose, and short enough to
 * read and verify by eye. It is not cryptographic and must never be used where
 * unpredictability matters.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  bool(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks by relative weight; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Approximately normal, clamped to [min, max]. */
  normal(mean: number, stdDev: number, min: number, max: number): number;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick() called with an empty list');
    return items[int(0, items.length - 1)]!;
  };

  const weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
    if (items.length === 0) throw new Error('weighted() called with an empty list');
    if (items.length !== weights.length) {
      throw new Error('weighted() needs one weight per item');
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) throw new Error('weighted() needs a positive total weight');

    let roll = next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  };

  /**
   * Sum of three uniforms — cheap, deterministic, and close enough to normal
   * for generating plausible durations. The Box–Muller transform would be more
   * correct and is unnecessary at this fidelity.
   */
  const normal = (mean: number, stdDev: number, min: number, max: number): number => {
    const u = (next() + next() + next()) / 3;
    const value = mean + (u - 0.5) * 2 * stdDev * Math.sqrt(3);
    return Math.min(max, Math.max(min, value));
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  return { next, int, bool: (p) => next() < p, pick, weighted, normal, shuffle };
}

/**
 * Derives an independent stream from a label.
 *
 * Each repository generates its own data from its own stream, so adding a
 * repository — or generating repository 5 without generating 1–4 first — does
 * not shift the numbers of any other. Without this, the dataset would only be
 * reproducible when generated in exactly one order.
 */
export function deriveSeed(base: number, label: string): number {
  let hash = base >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
