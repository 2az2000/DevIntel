import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

/**
 * One zod schema per payload, validated here. The parsed result is attached to
 * `req.validated` rather than replacing `req.body`, so a handler always knows
 * it is reading checked data — and unknown keys never reach Prisma, because
 * zod strips (or with `.strict()`, rejects) them.
 *
 * The Request augmentation lives in src/types/express.d.ts.
 */

export interface ValidationSchemas {
  readonly params?: ZodType;
  readonly query?: ZodType;
  readonly body?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const previous = req.validated;
      req.validated = {
        params: schemas.params ? schemas.params.parse(req.params) : (previous?.params ?? req.params),
        query: schemas.query ? schemas.query.parse(req.query) : (previous?.query ?? req.query),
        body: schemas.body ? schemas.body.parse(req.body) : (previous?.body ?? req.body),
      };
      next();
    } catch (err) {
      // A ZodError is mapped to VALIDATION_ERROR with per-field details by the
      // error mapper — the only place that formats a response.
      next(err);
    }
  };
}

/** Typed accessors, so controllers do not repeat the cast. */
export const body = <T>(req: Request): T => (req.validated?.body ?? req.body) as T;
export const query = <T>(req: Request): T => (req.validated?.query ?? req.query) as T;
export const params = <T>(req: Request): T => (req.validated?.params ?? req.params) as T;

/**
 * A single route parameter as a string. Express 5 types `req.params` values as
 * `string | string[]`, and every downstream consumer here wants a string.
 */
export function paramString(req: Request, key: string): string | null {
  const raw = (req.params as Record<string, string | string[] | undefined>)[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}
