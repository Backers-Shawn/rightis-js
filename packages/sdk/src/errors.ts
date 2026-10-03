/**
 * Every failure the SDK raises is a `RightisError`.
 *
 * Server errors carry the server's own code (`INSUFFICIENT_CREDIT`,
 * `RATE_LIMITED`, `UNAUTHENTICATED`, ...). Failures that never reached the
 * server use SDK codes: `NETWORK_ERROR`, `TIMEOUT`, `MISSING_API_KEY`,
 * `INVALID_ARGUMENT`, and the `WEBHOOK_*` codes.
 */
export class RightisError extends Error {
  /** Machine-readable code. Branch on this, not on `message`. */
  readonly code: string;
  /** HTTP status, or `null` when the request never got a response. */
  readonly status: number | null;
  /** The server's request id, when it sent one. Quote it when you contact support. */
  readonly requestId: string | null;
  readonly details: unknown;
  /** Seconds the server asked us to wait (`Retry-After`), when it said. */
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    code: string;
    message: string;
    status?: number | null;
    requestId?: string | null;
    details?: unknown;
    retryAfterSeconds?: number | null;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'RightisError';
    this.code = init.code;
    this.status = init.status ?? null;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

/** Raised by `webhooks.verify`. `code` says which check failed. */
export class RightisWebhookError extends RightisError {
  constructor(
    code:
      | 'WEBHOOK_SIGNATURE_MISSING'
      | 'WEBHOOK_SIGNATURE_MALFORMED'
      | 'WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE'
      | 'WEBHOOK_SIGNATURE_MISMATCH'
      | 'WEBHOOK_PAYLOAD_INVALID',
    message: string,
  ) {
    super({ code, message });
    this.name = 'RightisWebhookError';
  }
}

/**
 * Parses `Retry-After`: delay-seconds or an HTTP date. Returns seconds, or
 * `null` when absent or unreadable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/**
 * Builds a `RightisError` from a non-2xx response body.
 *
 * Understands the API envelope `{ error: { code, message, details }, request_id }`
 * and the OAuth form `{ error: "invalid_grant", error_description }`. Anything
 * else becomes `HTTP_<status>` so callers can still branch on the status.
 */
export function errorFromResponseBody(
  status: number,
  bodyText: string,
  headers?: { get(name: string): string | null },
): RightisError {
  const headerRequestId = headers?.get('x-request-id') ?? null;
  const retryAfterSeconds = parseRetryAfter(headers?.get('retry-after'));
  let parsed: unknown = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    const body = parsed as Record<string, unknown>;
    const requestId = typeof body.request_id === 'string' ? body.request_id : headerRequestId;
    const err = body.error;
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      return new RightisError({
        code: typeof e.code === 'string' ? e.code : `HTTP_${status}`,
        message: typeof e.message === 'string' ? e.message : `Request failed with status ${status}`,
        status,
        requestId,
        details: e.details ?? null,
        retryAfterSeconds,
      });
    }
    if (typeof err === 'string') {
      return new RightisError({
        code: err,
        message: typeof body.error_description === 'string' ? body.error_description : err,
        status,
        requestId,
        retryAfterSeconds,
      });
    }
  }

  return new RightisError({
    code: `HTTP_${status}`,
    message: `Request failed with status ${status}`,
    status,
    requestId: headerRequestId,
    retryAfterSeconds,
  });
}
