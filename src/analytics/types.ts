import type { MetricUnit } from '@shared/metrics.js';

/**
 * The score contract. A scoring function never returns a bare number.
 *
 * The diff of two ScoreResults IS the explanation of a change — sort the
 * component deltas and render a template. No explanation string is ever
 * hand-written. See docs/03-algorithms.md §1.
 */
export interface ScoreComponent {
  readonly key: string;
  /** The measured value in its natural unit; null when there was no data. */
  readonly raw: number | null;
  readonly unit: MetricUnit;
  /** 0–100 after the curve; null when there was no data. */
  readonly normalized: number | null;
  /** As applied, after redistribution across components with data. */
  readonly weight: number;
  readonly contribution: number;
  readonly status: 'ok' | 'insufficient_data';
}

export interface ScoreResult {
  /** 0–100, rounded to 2 decimals. */
  readonly value: number;
  /** Weights version, persisted with the snapshot so history stays honest. */
  readonly version: string;
  /** 0–1: share of weight backed by real data. Below 0.6 the UI marks the
   *  score provisional — a confident 84 from two of six components is a lie. */
  readonly coverage: number;
  readonly components: readonly ScoreComponent[];
}

export type TrendDirection =
  | 'improving'
  | 'declining'
  | 'stable'
  | 'volatile'
  | 'insufficient_data';

export interface TrendResult {
  readonly direction: TrendDirection;
  readonly changePercent: number | null;
  /** Set instead of changePercent when the baseline is below the metric's floor. */
  readonly changeAbsolute: number | null;
  readonly current: number;
  readonly previous: number;
  /** Coefficient of variation across the series. */
  readonly cv: number;
  /** Per-period OLS slope; null with fewer than 6 periods. */
  readonly slope: number | null;
  readonly rSquared: number | null;
  readonly confidence: 'low' | 'medium' | 'high';
}

export interface Anomaly {
  readonly periodStart: Date;
  readonly value: number;
  readonly median: number;
  readonly mad: number;
  readonly robustZ: number;
  readonly direction: 'above' | 'below';
  readonly harmful: boolean;
}

/** A point in a metric history. `sampleSize` is what stops a median over two
 *  observations from being treated as trustworthy downstream. */
export interface SeriesPoint {
  readonly periodStart: Date;
  readonly value: number;
  readonly sampleSize: number;
}
