/**
 * A result type for operations where failure is an ordinary outcome — parsing,
 * provider calls, resolution. Exceptions stay for genuinely exceptional cases;
 * a Result makes the failure path impossible for the caller to forget.
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Exhaustiveness guard. Put this in the `default` branch of every switch over a
 * union — adding a variant then breaks the build instead of silently falling
 * through.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
