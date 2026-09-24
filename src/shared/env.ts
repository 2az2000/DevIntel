import { z } from 'zod';

/**
 * Validated at boot; the process exits on failure.
 *
 * A service that starts with a missing secret and fails at 3 a.m. is worse than
 * one that refuses to start.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** 32 bytes, hex encoded — AES-256-GCM for provider tokens at rest. */
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  /** `seed` runs the entire system with no GitHub account and no network. */
  DATA_PROVIDER: z.enum(['seed', 'github']).default('seed'),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }

  // GitHub credentials are only required once the live provider is selected.
  if (parsed.data.DATA_PROVIDER === 'github') {
    const missing = (['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const).filter(
      (k) => !parsed.data[k],
    );
    if (missing.length > 0) {
      console.error(`DATA_PROVIDER=github requires: ${missing.join(', ')}\n`);
      process.exit(1);
    }
  }

  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
