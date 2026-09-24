import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { env } from '@shared/env.js';
import { logger } from './logger.js';
import { ok } from './http.js';
import { requestId, reqId } from './middleware/request-id.js';
import { errorMapper, notFound, h } from './middleware/error.js';
import { authenticate, checkOrigin } from './middleware/authenticate.js';
import { rateLimit } from './middleware/rate-limit.js';
import { resolveTenant } from './middleware/tenant.js';
import { validate } from './middleware/validate.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { workspaceRoutes } from './modules/workspaces/workspaces.routes.js';
import { teamRoutes } from './modules/teams/teams.module.js';
import { syncRoutes } from './modules/sync/sync.module.js';
import { WorkspaceParams } from './modules/workspaces/dto.js';

/**
 * Middleware order is the security model. Two orderings are load-bearing:
 *
 *   · Webhook routes mount BEFORE express.json(). The HMAC is computed over the
 *     raw body; once a JSON parser has touched it, the bytes you verify are not
 *     the bytes that were signed.
 *   · Rate limiting precedes authentication, so credential stuffing costs the
 *     attacker before it costs the database.
 *
 * Reference: docs/04-api.md §2
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer, without this every request shares one rate-limit
  // bucket because req.ip is the proxy's address.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(pinoHttp({ logger, genReqId: (req) => (req as { id: string }).id }));
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));

  // ── Webhooks: raw body, mounted before the JSON parser (M7) ──────────────
  app.use(
    '/api/v1/webhooks',
    express.raw({ type: 'application/json', limit: '5mb' }),
    webhookRouter(),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', checkOrigin(env.WEB_ORIGIN));
  app.use('/api/v1', authenticate());

  app.use('/api/v1', v1Router());

  app.use(notFound);
  app.use(errorMapper);

  return app;
}

function v1Router(): Router {
  const router = Router();

  router.get(
    '/health',
    h((req, res) => {
      ok(req, res, { status: 'ok', provider: env.DATA_PROVIDER });
    }),
  );

  router.use('/auth', authRoutes());

  // A general per-user ceiling. Endpoint-specific limits are declared on the
  // routes that need something tighter.
  router.use(rateLimit({ bucket: 'general', max: 300, windowSeconds: 60 }));

  router.use('/workspaces', workspaceRoutes());

  // Teams are workspace-scoped, so they mount under the tenant boundary and
  // resolve it themselves — `mergeParams` carries :workspaceId through.
  const teamScoped = Router({ mergeParams: true });
  teamScoped.use(validate({ params: WorkspaceParams }), resolveTenant());
  teamScoped.use('/teams', teamRoutes());
  teamScoped.use('/', syncRoutes());
  router.use('/workspaces/:workspaceId', teamScoped);

  return router;
}

function webhookRouter(): Router {
  const router = Router();

  // Signature verification happens here, on the raw buffer, before any parse.
  router.post('/:provider', (req, res) => {
    res.status(501).json({
      error: {
        code: 'UNPROCESSABLE',
        message: 'Webhook processing is implemented in M7',
        requestId: reqId(req),
      },
    });
  });

  return router;
}
