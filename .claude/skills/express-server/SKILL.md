---
name: express-server
description: Express server construction for this API — middleware order, async error handling, the error mapper, SSE streaming, raw-body webhook routes, security headers, rate limiting and graceful shutdown. Use when touching app wiring, middleware, error handling, or any cross-cutting server concern.
---

# Express server

Reference: [docs/04-api.md](../../../docs/04-api.md).

## Middleware order is the security model

```ts
app.use(requestId());                 // 1 correlation id, before anything can log
app.use(pinoHttp({ logger }));        // 2
app.use(helmet());                    // 3
app.use(cors({ origin: ALLOWED, credentials: true }));

app.use('/api/v1/webhooks', rawBody(), webhookRouter);   // 4 BEFORE json()

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(rateLimit());                 // 5 before auth — cheap rejection first
app.use(authenticate());              // 6 session → req.user
app.use('/api/v1/workspaces/:workspaceId', resolveTenant());  // 7 membership → req.db

app.use('/api/v1', routes);
app.use(notFound);
app.use(errorMapper);                 // last, and it takes 4 args
```

Two orderings are load-bearing:

- **Webhook routes mount before `express.json()`.** HMAC is computed over the *raw* body; once
  a JSON parser has touched it, the bytes you verify are not the bytes that were signed.
- **Rate limiting precedes authentication.** Credential stuffing should cost the attacker before
  it costs the database.

## Async errors

Express 4 does not catch rejected promises from handlers. Wrap every async handler once:

```ts
export const h = <T extends RequestHandler>(fn: T): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/teams', h(teamController.list));
```

Without this, a rejected promise hangs the request until timeout and never reaches the error
mapper. Add an ESLint rule banning bare `async` handlers in `routes.ts`.

## The error mapper is the only place that formats errors

```ts
export function errorMapper(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id;

  if (err instanceof ZodError)
    return res.status(400).json(envelope('VALIDATION_ERROR', 'Invalid request', requestId, issues(err)));

  if (err instanceof DomainError)
    return res.status(STATUS[err.code]).json(envelope(err.code, err.message, requestId));

  if (isPrismaUniqueViolation(err))
    return res.status(409).json(envelope('CONFLICT', 'Already exists', requestId));

  req.log.error({ err }, 'unhandled');
  Sentry.captureException(err);
  return res.status(500).json(envelope('INTERNAL', 'Something went wrong', requestId));
}
```

Never leak an internal message to the client on a 500. The `requestId` is the link between what
the user sees and the full trace in the logs.

A resource in another workspace returns **404, not 403** — a 403 confirms it exists.

## Controllers stay thin

```ts
export const create = h(async (req, res) => {
  const team = await teamService.create(req.db, req.validated.body);
  res.status(201).json({ data: serializeTeam(team), meta: { requestId: req.id } });
});
```

No business branching, no Prisma, no try/catch — the mapper handles failure.

## SSE

```ts
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',              // stops nginx buffering the stream
});

const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
req.on('close', () => { clearInterval(beat); unsubscribe(); });
```

Three things people forget: the heartbeat (proxies close idle connections), the `close` cleanup
(otherwise every disconnect leaks a subscription), and `X-Accel-Buffering`.

## Rate limiting

Sliding window in Redis, keyed per user where one exists and per IP otherwise. Login is limited
per IP **and** per email, and responds in constant time whether or not the account exists.

## Graceful shutdown

```ts
process.on('SIGTERM', async () => {
  server.close();                    // stop accepting
  await worker?.close();             // finish in-flight jobs
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});
```

Without this, a deploy kills in-flight jobs mid-transaction. The pipeline is idempotent so it
recovers — but recovery costs a re-fetch that a clean shutdown avoids.

## Traps

- `req.ip` needs `app.set('trust proxy', 1)` behind a load balancer, or every request shares one
  rate-limit bucket.
- Do not mutate `req.body` after validation; attach the parsed result to `req.validated`.
- `res.json()` on an already-sent response throws — return after every `res.*` call.
- Route order matters: `/pull-requests/:id` must not shadow `/pull-requests/stats`.

## Before finishing

- [ ] Handler wrapped for async errors
- [ ] Errors thrown as typed domain errors, formatted only by the mapper
- [ ] Webhook route mounted before the JSON parser
- [ ] SSE has heartbeat and cleanup
- [ ] Permission and validation declared on the route
