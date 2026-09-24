import pino from 'pino';
import { env, isProduction } from '@shared/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
  /**
   * Redaction is a safety net, not the primary control — tokens are encrypted
   * at rest and never returned by an endpoint. But a stray object spread into
   * a log line should not be the thing that leaks one.
   */
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.accessToken',
      '*.refreshToken',
      '*.accessTokenEnc',
      '*.refreshTokenEnc',
      '*.passwordHash',
      '*.password',
      '*.tokenHash',
      'GITHUB_CLIENT_SECRET',
      'SESSION_SECRET',
      'TOKEN_ENCRYPTION_KEY',
    ],
    censor: '[redacted]',
  },
});
