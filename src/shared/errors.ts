/**
 * Typed domain errors. Services throw these; the HTTP error mapper is the only
 * place that turns them into a status code and a response body.
 *
 * A raw `throw new Error()` anywhere in domain code is a bug — it reaches the
 * client as a generic 500 with no actionable message.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNPROCESSABLE',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, new.target);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

/**
 * Also used for a resource that exists in another workspace. Returning 403
 * there would confirm the row exists and turn the id space into an
 * enumeration oracle.
 */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  constructor(resource = 'Resource') {
    super(`${resource} not found`);
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED' as const;
  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'You do not have permission to do this') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
}

/** Valid shape, invalid domain state — e.g. a sync already running. */
export class UnprocessableError extends DomainError {
  readonly code = 'UNPROCESSABLE' as const;
}

export class ProviderError extends DomainError {
  readonly code = 'PROVIDER_ERROR' as const;
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean = true,
  ) {
    super(message);
  }
}

export class RateLimitedError extends DomainError {
  readonly code = 'RATE_LIMITED' as const;
  constructor(
    message = 'Too many requests',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
