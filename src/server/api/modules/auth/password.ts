import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the OWASP-recommended baseline: 19 MiB memory, 2 iterations,
 * 1 degree of parallelism.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> => hash(plain, OPTIONS);

export const verifyPassword = (digest: string, plain: string): Promise<boolean> =>
  verify(digest, plain, OPTIONS);

/**
 * A pre-computed hash of a value nobody knows, verified against when the email
 * does not exist.
 *
 * Without this, "no such user" returns in microseconds while a real account
 * costs ~50 ms of Argon2 — and that difference is a reliable oracle for
 * enumerating which email addresses have accounts. Burning the same work on a
 * miss removes the signal.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zYWx0LXZhbHVl$Qk9HVVMtSEFTSC1GT1ItVElNSU5HLU9OTFk';

export async function burnPasswordTime(plain: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plain, OPTIONS);
  } catch {
    // Expected: the dummy digest never verifies, and may not even parse. The
    // point is the elapsed time, not the result.
  }
}
