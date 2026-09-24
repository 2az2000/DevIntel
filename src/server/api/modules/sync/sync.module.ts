import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { NotFoundError, UnprocessableError } from '@shared/errors.js';
import { accepted, ok } from '../../http.js';
import { h } from '../../middleware/error.js';
import { params, validate } from '../../middleware/validate.js';
import { dbOf, requirePermission, tenantOf } from '../../middleware/tenant.js';
import { audit } from '../../audit.js';
import { startSyncRun } from '../../../worker/stages/ingest.js';
import { WorkspaceParams } from '../workspaces/dto.js';

/**
 * Sync control and live progress.
 *
 * Starting a sync returns 202 with a run id, never a completed result: a first
 * sync is thousands of paginated calls under a rate limit, and doing that
 * inside a request means a timeout and a run that loses its progress on every
 * retry. The work is queued; this endpoint reports on it.
 *
 * Reference: docs/02-pipeline.md §5, docs/04-api.md §6
 */

const RunParams = WorkspaceParams.extend({ runId: z.string().min(1) });
const IntegrationParams = WorkspaceParams.extend({ integrationId: z.string().min(1) });

// ── Controllers ─────────────────────────────────────────────────────────────

const start = async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = tenantOf(req);
  const { integrationId } = params<{ integrationId: string }>(req);
  const db = dbOf(req);

  const integration = await db.integration.findFirst({
    where: { id: integrationId },
    select: { id: true, status: true },
  });
  if (!integration) throw new NotFoundError('Integration');

  if (integration.status !== 'ACTIVE') {
    throw new UnprocessableError(
      `This integration is ${integration.status.toLowerCase().replace('_', ' ')} and cannot sync until it is reconnected`,
    );
  }

  const runId = await startSyncRun(workspaceId, integrationId, 'INCREMENTAL');

  await audit(req, {
    workspaceId,
    action: 'sync.started',
    resourceType: 'SyncRun',
    resourceId: runId,
    metadata: { integrationId },
  });

  accepted(req, res, { syncRunId: runId, status: 'RUNNING' });
};

const listRuns = async (req: Request, res: Response): Promise<void> => {
  const runs = await dbOf(req).syncRun.findMany({
    select: {
      id: true,
      kind: true,
      status: true,
      stats: true,
      startedAt: true,
      finishedAt: true,
      error: true,
      integrationId: true,
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  ok(req, res, { runs });
};

const getRun = async (req: Request, res: Response): Promise<void> => {
  const { runId } = params<{ runId: string }>(req);
  const run = await dbOf(req).syncRun.findFirst({
    where: { id: runId },
    select: {
      id: true,
      kind: true,
      status: true,
      stats: true,
      startedAt: true,
      finishedAt: true,
      error: true,
    },
  });
  if (!run) throw new NotFoundError('Sync run');
  ok(req, res, { run });
};

/**
 * Server-sent events over polling, because the browser reconnects on its own
 * and the payload is one-directional. A WebSocket would add a protocol for no
 * benefit here.
 */
const streamRun = (req: Request, res: Response): void => {
  const { runId } = params<{ runId: string }>(req);
  const db = dbOf(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, nginx buffers the whole stream and delivers nothing until
    // the response ends — which for a stream is never.
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  let lastSerialized = '';

  const poll = async (): Promise<void> => {
    if (closed) return;

    const run = await db.syncRun.findFirst({
      where: { id: runId },
      select: { id: true, status: true, stats: true, error: true, finishedAt: true },
    });

    if (!run) {
      send('error', { message: 'Sync run not found' });
      cleanup();
      res.end();
      return;
    }

    // Only emit on change. A client that renders every frame would otherwise
    // repaint a static progress bar several times a second.
    const serialized = JSON.stringify(run);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      send('progress', run);
    }

    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') {
      send('done', { status: run.status, error: run.error });
      cleanup();
      res.end();
    }
  };

  const interval = setInterval(() => void poll().catch(() => cleanup()), 1_000);

  // Proxies close a connection that has been idle for ~30–60s. The comment
  // frame is ignored by EventSource and keeps the connection alive.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  }

  // Mandatory: without it every navigation leaks a timer and a held connection.
  req.on('close', cleanup);

  void poll();
};

// ── Routes ──────────────────────────────────────────────────────────────────

export function syncRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/runs', requirePermission('workspace.read'), h(listRuns));
  router.get(
    '/runs/:runId',
    requirePermission('workspace.read'),
    validate({ params: RunParams }),
    h(getRun),
  );
  router.get(
    '/runs/:runId/stream',
    requirePermission('workspace.read'),
    validate({ params: RunParams }),
    streamRun,
  );

  router.post(
    '/integrations/:integrationId/sync',
    requirePermission('integrations.manage'),
    validate({ params: IntegrationParams }),
    h(start),
  );

  return router;
}
