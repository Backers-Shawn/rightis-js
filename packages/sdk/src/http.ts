import { RightisError, errorFromResponseBody } from './errors.js';
import { SDK_VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://rightis.org';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
/** A `Retry-After` longer than this is not waited out; the error is returned to you instead. */
export const MAX_RETRY_AFTER_SECONDS = 60;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  /** @internal Test hook for the backoff wait. */
  sleep?: (ms: number) => Promise<void>;
  /** @internal Test hook for jitter. */
  random?: () => number;
}

export interface RequestSpec {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Bearer credential. Never logged, never put in an error message. */
  bearer?: string | null;
  /**
   * Whether a retry is safe. Defaults to true for GET and false otherwise.
   * The Rightis API has no general Idempotency-Key header, so POSTs are not
   * retried unless the endpoint itself is idempotent (usage events dedupe on
   * `event_id`).
   */
  retryable?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Trims a base URL and refuses anything that is not http(s). */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RightisError({ code: 'INVALID_ARGUMENT', message: `baseUrl is not an absolute URL: ${trimmed}` });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RightisError({ code: 'INVALID_ARGUMENT', message: 'baseUrl must use https (or http on localhost)' });
  }
  return trimmed;
}

/** http is acceptable only for a server on this machine. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

function isNodeRuntime(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } }; window?: unknown };
  return typeof g.window === 'undefined' && typeof g.process?.versions?.node === 'string';
}

export class HttpClient {
  readonly baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new RightisError({
        code: 'INVALID_ARGUMENT',
        message: 'No fetch implementation found. Use Node 20 or later, or pass { fetch }.',
      });
    }
    this.#fetch = f;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#random = opts.random ?? Math.random;
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    const url = this.#url(spec);
    const retryable = spec.retryable ?? spec.method === 'GET';
    const headers: Record<string, string> = { accept: 'application/json' };
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    if (spec.bearer) headers.authorization = `Bearer ${spec.bearer}`;
    // Browsers send their own User-Agent, and setting one there would also
    // trigger a CORS preflight the keyless endpoints do not allow.
    if (isNodeRuntime()) headers['user-agent'] = `rightis-sdk-js/${SDK_VERSION}`;
    const body = spec.body === undefined ? undefined : JSON.stringify(spec.body);

    for (let attempt = 0; ; attempt++) {
      const canRetry = retryable && attempt < this.#maxRetries;
      let res: Response;
      try {
        res = await this.#fetchWithTimeout(url, { method: spec.method, headers, body });
      } catch (cause) {
        const timedOut = cause instanceof RightisError && cause.code === 'TIMEOUT';
        if (canRetry) {
          await this.#sleep(this.#backoffMs(attempt));
          continue;
        }
        if (timedOut) throw cause;
        throw new RightisError({
          code: 'NETWORK_ERROR',
          message: `Could not reach ${this.baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        });
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new RightisError({
            code: 'INVALID_RESPONSE',
            message: `Expected JSON from ${spec.method} ${spec.path}`,
            status: res.status,
            requestId: res.headers.get('x-request-id'),
          });
        }
      }

      const err = errorFromResponseBody(res.status, await res.text().catch(() => ''), res.headers);
      const transient = res.status === 429 || res.status >= 500;
      if (canRetry && transient) {
        if (err.retryAfterSeconds !== null && err.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) throw err;
        const wait = err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : this.#backoffMs(attempt);
        await this.#sleep(wait);
        continue;
      }
      throw err;
    }
  }

  #url(spec: RequestSpec): string {
    const url = new URL(this.baseUrl + spec.path);
    for (const [k, v] of Object.entries(spec.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  /** Exponential backoff with jitter: about 0.5s, 1s, 2s, capped at 8s. */
  #backoffMs(attempt: number): number {
    const base = Math.min(8_000, 500 * 2 ** attempt);
    return Math.round(base * (0.5 + this.#random() * 0.5));
  }

  async #fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (timedOut) {
        throw new RightisError({ code: 'TIMEOUT', message: `Request timed out after ${this.#timeoutMs} ms`, cause });
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }
}
