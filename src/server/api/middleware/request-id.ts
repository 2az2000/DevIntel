import type { Request, RequestHandler } from 'express';
import { nanoid } from 'nanoid';

/**
 * Correlation id: in the response header, in every log line, in the Sentry
 * event. A user quoting one string is enough to retrieve the whole trace.
 *
 * `req.id` is declared by pino-http as `string | number`, so this module does
 * not redeclare it — it sets it and provides a string accessor instead.
 */
export const requestId = (): RequestHandler => (req, res, next) => {
  const inbound = req.header('x-request-id');
  // An inbound id is honoured so a trace survives a proxy, but length-capped:
  // it is attacker-controlled and ends up in log storage.
  req.id = inbound && inbound.length <= 64 ? inbound : `req_${nanoid(16)}`;
  res.setHeader('x-request-id', String(req.id));
  next();
};

/**
 * pino-http types `req.id` as `string | number | object`. Only the first two
 * are ever produced here; an object would stringify to "[object Object]" and
 * make the correlation id useless, so it is treated as absent instead.
 */
export const reqId = (req: Request): string => {
  if (typeof req.id === 'string') return req.id;
  if (typeof req.id === 'number') return String(req.id);
  return '';
};
