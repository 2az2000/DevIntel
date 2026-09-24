import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { ERROR_STATUS, isDomainError } from '@shared/errors.js';
import { isProduction } from '@shared/env.js';
import { reqId } from './request-id.js';

/**
 * Express 5 forwards rejected promises to the error handler, but only for
 * handlers it recognizes as returning one. Wrapping keeps that guarantee
 * explicit and uniform — without it a rejection can hang the request until
 * timeout instead of reaching the mapper.
 */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

const envelope = (
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorBody => ({
  error: details === undefined ? { code, message, requestId } : { code, message, details, requestId },
});

export function notFound(req: Request, res: Response): void {
  res.status(404).json(envelope('NOT_FOUND', `No route for ${req.method} ${req.path}`, reqId(req)));
}

/**
 * The only place that formats an error response.
 *
 * Note what does NOT happen here: an internal message is never sent to the
 * client on a 500. `requestId` is the link between what the user can quote and
 * the full trace in the logs.
 */
export function errorMapper(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = reqId(req);

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    res.status(400).json(envelope('VALIDATION_ERROR', 'Invalid request', requestId, details));
    return;
  }

  if (isDomainError(err)) {
    res
      .status(ERROR_STATUS[err.code])
      .json(envelope(err.code, err.message, requestId, err.details));
    return;
  }

  req.log.error({ err }, 'unhandled error');

  res
    .status(500)
    .json(
      envelope(
        'INTERNAL',
        isProduction ? 'Something went wrong' : String(err),
        requestId,
      ),
    );
}
