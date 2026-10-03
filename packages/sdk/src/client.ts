import { RightisError } from './errors.js';
import { DEFAULT_BASE_URL, HttpClient, isLoopbackUrl, type FetchLike, type HttpClientOptions } from './http.js';
import type {
  ApiEnvironment,
  ConsoleCreateKeyInput,
  ConsoleCreateKeyResult,
  ConsoleOverview,
  ConsoleSetupInput,
  ConsoleSetupResult,
  LicenseRequestInput,
  LicenseRequestView,
  LicenseVerifyInput,
  LicenseVerifyResult,
  RightsCheckInput,
  RightsCheckResult,
  RightsLookupResult,
  RightsSearchResult,
  SandboxPeopleResult,
  UsageBatchResult,
  UsageEvent,
  WebhookEvent,
} from './types.js';
import { verifyWebhook, type VerifyWebhookOptions } from './webhooks.js';

/** The most events one `usage.log` call accepts. */
export const USAGE_BATCH_MAX = 500;

export interface RightisOptions {
  /**
   * Secret API key, `brk_test_...` (sandbox) or `brk_live_...` (production).
   * Defaults to `process.env.RIGHTIS_SECRET_KEY` where `process` exists.
   * Pass `null` to force the keyless public path even when the variable is set.
   * Server-side only: never ship a secret key to a browser.
   */
  apiKey?: string | null;
  /** Defaults to `process.env.RIGHTIS_API_URL`, then `https://rightis.org`. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Per-attempt timeout. Default 30000. */
  timeoutMs?: number;
  /** Retries for transient failures on safe requests. Default 2. */
  maxRetries?: number;
}

/** @internal */
export interface InternalOptions {
  sleep?: HttpClientOptions['sleep'];
  random?: HttpClientOptions['random'];
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** `sandbox` for `brk_test_`, `production` for `brk_live_`, otherwise `null`. Does not validate the rest of the key. */
export function keyEnvironment(key: string | null | undefined): ApiEnvironment | null {
  if (!key) return null;
  if (key.startsWith('brk_test_')) return 'sandbox';
  if (key.startsWith('brk_live_')) return 'production';
  return null;
}

/**
 * Rightis API client.
 *
 * ```ts
 * const rightis = new Rightis(); // reads RIGHTIS_SECRET_KEY
 * const result = await rightis.rights.check({ rights_id: 'BR-...', use_type: 'instagram ad', asset_types: ['face'] });
 * // result.decision === 'allowed' is NOT permission to use. Follow result.next_action.
 * ```
 */
export class Rightis {
  readonly rights: RightsResource;
  readonly licenses: LicensesResource;
  readonly usage: UsageResource;
  readonly sandbox: SandboxResource;
  readonly webhooks: WebhooksResource;
  readonly baseUrl: string;
  // Private field: does not show up in console.log or JSON.stringify.
  readonly #apiKey: string | null;

  constructor(options: RightisOptions = {}, internal: InternalOptions = {}) {
    const apiKey = options.apiKey === null ? null : (options.apiKey?.trim() || readEnv('RIGHTIS_SECRET_KEY') || null);
    const http = new HttpClient({
      baseUrl: options.baseUrl ?? readEnv('RIGHTIS_API_URL') ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      sleep: internal.sleep,
      random: internal.random,
    });
    if (apiKey && http.baseUrl.startsWith('http:') && !isLoopbackUrl(http.baseUrl)) {
      throw new RightisError({
        code: 'INVALID_ARGUMENT',
        message: 'Refusing to send an API key over plain http to a non-local host. Use https.',
      });
    }
    this.#apiKey = apiKey;
    this.baseUrl = http.baseUrl;
    const key = () => this.#apiKey;
    this.rights = new RightsResource(http, key);
    this.licenses = new LicensesResource(http, key);
    this.usage = new UsageResource(http, key);
    this.sandbox = new SandboxResource(http, key);
    this.webhooks = new WebhooksResource();
  }

  /** Whether a key is configured. The key itself is never exposed. */
  get hasApiKey(): boolean {
    return this.#apiKey !== null;
  }

  /** `sandbox` or `production` from the key prefix, `null` without a key. */
  get environment(): ApiEnvironment | null {
    return keyEnvironment(this.#apiKey);
  }
}

type KeyGetter = () => string | null;

function requireKey(key: KeyGetter, what: string): string {
  const k = key();
  if (!k) {
    throw new RightisError({
      code: 'MISSING_API_KEY',
      message: `${what} needs an API key. Set RIGHTIS_SECRET_KEY or pass { apiKey }.`,
    });
  }
  return k;
}

const RESOLVE_FIELDS = ['rights_id', 'use_type', 'media_types', 'ai_methods', 'territory', 'asset_types', 'for_training'] as const;

export class RightsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly key: KeyGetter,
  ) {}

  /**
   * Asks whether a described use of an identity is cleared, and what to do next.
   *
   * With an API key this calls `POST /api/v1/rights/check` (scope `rights:check`);
   * without one it calls the keyless `POST /api/public/v1/rights/resolve`. Both
   * return the same Resolve contract.
   *
   * **`decision: 'allowed'` is not free use.** It means a licence request in
   * these scopes is approved without the holder reviewing it, provided the fee
   * clears their floor. `next_action.type` is still `request_license`. Read
   * `next_action`, not just `decision`. A `null` decision means no use was
   * described or the ID is not registered, and not registered is not permission.
   */
  async check(input: RightsCheckInput): Promise<RightsCheckResult> {
    if (!input || typeof input.rights_id !== 'string' || !input.rights_id.trim()) {
      throw new RightisError({ code: 'INVALID_ARGUMENT', message: 'rights_id is required' });
    }
    const apiKey = this.key();
    if (apiKey) {
      return this.http.request<RightsCheckResult>({
        method: 'POST',
        path: '/api/v1/rights/check',
        body: input,
        bearer: apiKey,
      });
    }
    // The public route takes only the Resolve fields.
    const body: Record<string, unknown> = {};
    for (const f of RESOLVE_FIELDS) {
      if (input[f] !== undefined) body[f] = input[f];
    }
    return this.http.request<RightsCheckResult>({
      method: 'POST',
      path: '/api/public/v1/rights/resolve',
      body,
      // A read with no side effects: safe to retry.
      retryable: true,
    });
  }

  /** Keyless lookup of one Rights ID. Lists states, does not judge a use; use `check` for that. */
  async lookup(rightsId: string): Promise<RightsLookupResult> {
    return this.http.request<RightsLookupResult>({
      method: 'GET',
      path: '/api/public/v1/rights/lookup',
      query: { rights_id: rightsId },
    });
  }

  /** Keyless name search over listed registrations. */
  async search(q: string, opts: { limit?: number } = {}): Promise<RightsSearchResult> {
    return this.http.request<RightsSearchResult>({
      method: 'GET',
      path: '/api/public/v1/rights/search',
      query: { q, limit: opts.limit },
    });
  }
}

export class LicensesResource {
  constructor(
    private readonly http: HttpClient,
    private readonly key: KeyGetter,
  ) {}

  /**
   * Files a licence request (scope `license:request`). Not retried: a retry
   * could file the request twice. Sandbox keys get a synthetic response and
   * nothing is written.
   */
  async request(input: LicenseRequestInput): Promise<LicenseRequestView> {
    return this.http.request<LicenseRequestView>({
      method: 'POST',
      path: '/api/v1/licenses/requests',
      body: input,
      bearer: requireKey(this.key, 'licenses.request'),
    });
  }

  /** Verifies a licence by id, public code or content hash (scope `license:verify`). */
  async verify(input: LicenseVerifyInput): Promise<LicenseVerifyResult> {
    if (!input || (!input.license_id && !input.license_public_code && !input.content_hash)) {
      throw new RightisError({
        code: 'INVALID_ARGUMENT',
        message: 'license_id, license_public_code, or content_hash is required',
      });
    }
    return this.http.request<LicenseVerifyResult>({
      method: 'POST',
      path: '/api/v1/licenses/verify',
      body: input,
      bearer: requireKey(this.key, 'licenses.verify'),
    });
  }
}

export class UsageResource {
  constructor(
    private readonly http: HttpClient,
    private readonly key: KeyGetter,
  ) {}

  /**
   * Records usage against licences (scope `usage:write`), 1 to 500 events.
   * Each event is recorded, reported as a duplicate, or rejected on its own;
   * check `results`. The server dedupes on `event_id`, so this call is retried
   * on transient failures and a resend is reported as `duplicate`.
   */
  async log(events: UsageEvent[]): Promise<UsageBatchResult> {
    if (!Array.isArray(events) || events.length === 0 || events.length > USAGE_BATCH_MAX) {
      throw new RightisError({
        code: 'INVALID_ARGUMENT',
        message: `usage.log takes 1 to ${USAGE_BATCH_MAX} events`,
      });
    }
    return this.http.request<UsageBatchResult>({
      method: 'POST',
      path: '/api/v1/usage',
      body: { events },
      bearer: requireKey(this.key, 'usage.log'),
      retryable: true,
    });
  }
}

export class SandboxResource {
  constructor(
    private readonly http: HttpClient,
    private readonly key: KeyGetter,
  ) {}

  /** The fixed sample people a sandbox key can check against. Needs a `brk_test_` key. */
  async people(): Promise<SandboxPeopleResult> {
    return this.http.request<SandboxPeopleResult>({
      method: 'GET',
      path: '/api/v1/sandbox/people',
      bearer: requireKey(this.key, 'sandbox.people'),
    });
  }
}

export class WebhooksResource {
  /** See `verifyWebhook`. */
  verify<T = unknown>(opts: VerifyWebhookOptions): Promise<WebhookEvent<T>> {
    return verifyWebhook<T>(opts);
  }
}

export interface RightisConsoleOptions {
  /** OAuth access token (`rat_...`) with scope `console:manage`. API keys are refused by the server. */
  accessToken: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Console API: organisation setup and key management for the signed-in
 * developer. Used by the `rightis` CLI. Requires the Rightis server release
 * that adds `/api/v1/console`.
 */
export class RightisConsole {
  readonly baseUrl: string;
  readonly #http: HttpClient;
  readonly #token: string;

  constructor(options: RightisConsoleOptions, internal: InternalOptions = {}) {
    if (!options.accessToken) throw new RightisError({ code: 'INVALID_ARGUMENT', message: 'accessToken is required' });
    this.#http = new HttpClient({
      baseUrl: options.baseUrl ?? readEnv('RIGHTIS_API_URL') ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      sleep: internal.sleep,
      random: internal.random,
    });
    this.baseUrl = this.#http.baseUrl;
    this.#token = options.accessToken;
  }

  get(): Promise<ConsoleOverview> {
    return this.#http.request({ method: 'GET', path: '/api/v1/console', bearer: this.#token });
  }

  setup(input: ConsoleSetupInput): Promise<ConsoleSetupResult> {
    return this.#http.request({ method: 'POST', path: '/api/v1/console/setup', body: input, bearer: this.#token });
  }

  /** Issues a key. The returned `secret` is shown once: write it somewhere safe and never log it. */
  createKey(input: ConsoleCreateKeyInput): Promise<ConsoleCreateKeyResult> {
    return this.#http.request({ method: 'POST', path: '/api/v1/console/keys', body: input, bearer: this.#token });
  }

  revokeKey(id: string): Promise<void> {
    return this.#http.request({
      method: 'DELETE',
      path: `/api/v1/console/keys/${encodeURIComponent(id)}`,
      bearer: this.#token,
    });
  }
}
