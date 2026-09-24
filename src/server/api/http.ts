import type { Request, Response } from 'express';
import { reqId } from './middleware/request-id.js';

/**
 * The response envelope. One place builds it, so `meta.requestId` can never be
 * forgotten and the shape cannot drift between modules.
 *
 * Reference: docs/04-api.md §3.1
 */

export function ok<T>(req: Request, res: Response, data: T, status = 200): void {
  res.status(status).json({ data, meta: { requestId: reqId(req) } });
}

export function created<T>(req: Request, res: Response, data: T): void {
  ok(req, res, data, 201);
}

/** 202 for work that is queued rather than done — sync runs, report generation. */
export function accepted<T>(req: Request, res: Response, data: T): void {
  ok(req, res, data, 202);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export function page<T>(req: Request, res: Response, result: Paginated<T>): void {
  res.status(200).json({
    data: result.items,
    pagination: {
      nextCursor: result.nextCursor,
      hasMore: result.nextCursor !== null,
      limit: result.limit,
    },
    meta: { requestId: reqId(req) },
  });
}

/**
 * Cursor pagination helper. Callers fetch `limit + 1` rows; this trims the
 * extra one and turns it into the cursor. Offset pagination is not used
 * anywhere — on continuously-written tables it skips and duplicates rows.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Paginated<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? last.id : null,
    limit,
  };
}
