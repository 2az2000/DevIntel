import { Router } from 'express';
import { h } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { loginLimiter, rateLimit } from '../../middleware/rate-limit.js';
import { LoginSchema, RegisterSchema, SessionIdParams } from './dto.js';
import * as controller from './auth.controller.js';

/**
 * Path, method, rate limit, schema, handler. Nothing else lives in a routes
 * file — no logic, no branching.
 */
export function authRoutes(): Router {
  const router = Router();

  router.post(
    '/register',
    rateLimit({ bucket: 'register', max: 5, windowSeconds: 900 }),
    validate({ body: RegisterSchema }),
    h(controller.register),
  );

  router.post(
    '/login',
    // Per IP *and* per email — see rate-limit.ts for why both are needed.
    loginLimiter(),
    validate({ body: LoginSchema }),
    h(controller.login),
  );

  router.post(
    '/refresh',
    rateLimit({ bucket: 'refresh', max: 60, windowSeconds: 900 }),
    h(controller.refresh),
  );

  router.post('/logout', h(controller.logout));
  router.post('/logout-all', requireAuth(), h(controller.logoutAll));

  router.get('/me', requireAuth(), h(controller.me));

  router.get('/sessions', requireAuth(), h(controller.listSessions));
  router.delete(
    '/sessions/:id',
    requireAuth(),
    validate({ params: SessionIdParams }),
    h(controller.revokeSession),
  );

  return router;
}
