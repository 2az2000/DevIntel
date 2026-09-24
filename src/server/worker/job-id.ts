/**
 * Deterministic BullMQ job ids.
 *
 * A pure function with no imports, deliberately in its own module: `queues.ts`
 * opens a Redis connection and validates the environment at import time, so
 * anything living there cannot be unit-tested without infrastructure. Keeping
 * the pure part separate is the same functional-core / imperative-shell split
 * the analytics layer uses.
 *
 * BullMQ REJECTS a custom job id containing `:` — Redis's own key separator —
 * and the error surfaces only at `queue.add()` time, never at compile time. The
 * natural instinct is to write `sync:${a}:${b}`, so this helper and the test
 * beside it exist to make that mistake impossible to repeat.
 *
 * A deterministic id collapses a burst of triggers on one subject into a single
 * unit of work. The deduplication window is `removeOnComplete.age`: once the
 * completed job leaves Redis, the same id can be enqueued again.
 */
export function jobId(...parts: readonly (string | number)[]): string {
  return parts.map((part) => String(part).replaceAll(':', '_')).join('~');
}
