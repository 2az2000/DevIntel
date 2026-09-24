/**
 * Time helpers.
 *
 * Two rules the whole system depends on:
 *   1. Everything is stored and computed in UTC. Timezone conversion happens
 *      once, at the workspace boundary, when bucketing days.
 *   2. Nothing here reads the clock. `now` is always a parameter, which is what
 *      keeps the analytics layer deterministic and testable.
 */

import type { Days, Minutes } from './brand.js';
import { days as toDays, minutes as toMinutes } from './brand.js';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function diffMinutes(from: Date, to: Date): Minutes {
  return toMinutes(Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE));
}

export function diffDays(from: Date, to: Date): Days {
  return toDays((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, count: number): Date {
  return new Date(date.getTime() + count * MS_PER_DAY);
}

/** UTC midnight of the given instant. Day bucketing by workspace timezone is
 *  done in SQL — see docs/02-pipeline.md §6. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `YYYY-MM-DD` in UTC — the key format for daily rollups. */
export function toDateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

export function eachDayBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = startOfUtcDay(from); d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Weekend by ISO convention. Used to make activity rhythm realistic and to
 *  avoid penalizing people for not committing on Saturdays. */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function countWeekdays(from: Date, to: Date): number {
  return eachDayBetween(from, to).filter((d) => !isWeekend(d)).length;
}

export const PERIODS = ['7d', '30d', '90d', '6m', '1y', 'all', 'custom'] as const;
export type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<Period, 'all' | 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '1y': 365,
};

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/** `now` is a parameter, never `Date.now()`. */
export function resolvePeriod(period: Period, now: Date, custom?: DateRange): DateRange {
  if (period === 'custom') {
    if (!custom) throw new Error('resolvePeriod: custom period requires an explicit range');
    return custom;
  }
  if (period === 'all') {
    return { from: new Date(0), to: now };
  }
  return { from: addDays(now, -PERIOD_DAYS[period]), to: now };
}
