import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens and provider-token encryption.
 *
 * Two separate concerns with two different treatments:
 *   · Session tokens are HASHED — we never need the original back, so storing
 *     a hash means a database leak yields no usable session.
 *   · Provider OAuth tokens are ENCRYPTED — we must send them to GitHub, so
 *     they have to be recoverable. AES-256-GCM, key from the environment.
 */

// ── Session tokens ──────────────────────────────────────────────────────────

/** 32 bytes of entropy, base64url. Returned to the client exactly once. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** SHA-256 is correct here: the input is already high-entropy, so a slow KDF
 *  would add latency to every request and no security. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// ── Provider tokens ─────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const keyFrom = (hexKey: string): Buffer => {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
};

/** Layout: `iv (12) || ciphertext || authTag (16)`. */
export function encryptToken(plaintext: string, hexKey: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyFrom(hexKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
}

export function decryptToken(payload: Buffer, hexKey: string): string {
  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Encrypted token payload is too short to be valid');
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, keyFrom(hexKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Comparison ──────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison. Length is compared first and leaks, which is
 * acceptable for the fixed-length hashes and signatures this is used on.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 hex digest — used for the OAuth `state` cookie and webhooks. */
export const sign = (value: string, secret: string): string =>
  createHash('sha256').update(`${secret}:${value}`).digest('hex');
