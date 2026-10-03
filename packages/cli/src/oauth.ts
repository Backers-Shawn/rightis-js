import { createHash, randomBytes } from 'node:crypto';

import { RightisError, errorFromResponseBody, type FetchLike } from '@rightis/sdk';

import { configDir } from './config.js';
import {
  deleteCredentials,
  readCachedClientId,
  readCredentials,
  writeCachedClientId,
  writeCredentials,
  type Credentials,
} from './credentials.js';
import { CliError } from './errors.js';
import type { Io } from './io.js';
import { LoopbackError, startLoopback } from './loopback.js';
import { CLI_VERSION } from './version.js';

/** What the CLI asks for: console management (init, whoami) and rights checks. */
export const CLI_SCOPES = 'console:manage rights:check';
/** Registered once; the authorization request adds the runtime port (RFC 8252 §7.3). */
export const REGISTERED_REDIRECT_URI = 'http://127.0.0.1/callback';
/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 challenge for a verifier (RFC 7636 §4.2). */
export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest());
}

/** 32 random bytes as base64url: a 43-character verifier from the unreserved set. */
export function createPkce(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: challengeFor(verifier), method: 'S256' };
}

export function randomState(): string {
  return base64url(randomBytes(16));
}

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw errorFromResponseBody(res.status, text, res.headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RightisError({ code: 'INVALID_RESPONSE', message: 'Expected JSON from the authorization server', status: res.status });
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** RFC 8414 discovery. The issuer must be the base URL, and every endpoint must live on it. */
export async function discover(fetch: FetchLike, baseUrl: string): Promise<AuthServerMetadata> {
  const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`, { headers: { accept: 'application/json' } });
  const meta = await readJsonResponse<AuthServerMetadata>(res);
  if (!meta || typeof meta.authorization_endpoint !== 'string' || typeof meta.token_endpoint !== 'string') {
    throw new CliError(`${baseUrl} did not return OAuth authorization server metadata.`);
  }
  if ((meta.issuer ?? '').replace(/\/+$/, '') !== baseUrl) {
    throw new CliError(`Issuer mismatch: ${baseUrl} says its issuer is ${meta.issuer}. Use --base-url ${meta.issuer}.`);
  }
  for (const ep of [meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint, meta.revocation_endpoint]) {
    if (ep && !sameOrigin(ep, baseUrl)) throw new CliError(`Refusing endpoint on another origin: ${ep}`);
  }
  return meta;
}

/** Dynamic Client Registration (RFC 7591) as a public client. */
export async function registerClient(fetch: FetchLike, meta: AuthServerMetadata): Promise<string> {
  if (!meta.registration_endpoint) throw new CliError('This server does not offer dynamic client registration.');
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Rightis CLI',
      redirect_uris: [REGISTERED_REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: CLI_SCOPES,
      software_id: 'rightis-cli',
      software_version: CLI_VERSION,
    }),
  });
  const body = await readJsonResponse<{ client_id?: string }>(res);
  if (!body.client_id) throw new CliError('Client registration returned no client_id.');
  return body.client_id;
}

export function buildAuthorizeUrl(
  meta: AuthServerMetadata,
  p: { clientId: string; redirectUri: string; state: string; challenge: string; scope?: string },
): string {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scope ?? CLI_SCOPES);
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function postForm<T>(fetch: FetchLike, url: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  return readJsonResponse<T>(res);
}

function checkTokens(t: TokenResponse): TokenResponse {
  if (!t || typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string' || typeof t.expires_in !== 'number') {
    throw new CliError('The token endpoint returned an unexpected response.');
  }
  return t;
}

export async function exchangeCode(
  fetch: FetchLike,
  tokenEndpoint: string,
  p: { code: string; verifier: string; redirectUri: string; clientId: string },
): Promise<TokenResponse> {
  return checkTokens(
    await postForm<TokenResponse>(fetch, tokenEndpoint, {
      grant_type: 'authorization_code',
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
    }),
  );
}

export async function refreshTokens(
  fetch: FetchLike,
  tokenEndpoint: string,
  p: { refreshToken: string; clientId: string },
): Promise<TokenResponse> {
  return checkTokens(
    await postForm<TokenResponse>(fetch, tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: p.refreshToken,
      client_id: p.clientId,
    }),
  );
}

export async function revokeToken(
  fetch: FetchLike,
  revocationEndpoint: string,
  p: { token: string; hint: 'refresh_token' | 'access_token'; clientId: string },
): Promise<void> {
  const res = await fetch(revocationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: p.token, token_type_hint: p.hint, client_id: p.clientId }).toString(),
  });
  if (!res.ok) throw errorFromResponseBody(res.status, await res.text().catch(() => ''), res.headers);
}

export function toCredentials(
  t: TokenResponse,
  ctx: { clientId: string; baseUrl: string; meta: Pick<AuthServerMetadata, 'token_endpoint' | 'revocation_endpoint'> },
  nowMs: number,
): Credentials {
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(nowMs + t.expires_in * 1000).toISOString(),
    client_id: ctx.clientId,
    base_url: ctx.baseUrl,
    scope: t.scope,
    token_endpoint: ctx.meta.token_endpoint,
    revocation_endpoint: ctx.meta.revocation_endpoint,
  };
}

/** The browser login. Stores credentials and returns them. Never prints a token. */
export async function login(io: Io, baseUrl: string, opts: { reregister?: boolean; browser?: boolean } = {}): Promise<Credentials> {
  const dir = configDir(io.env);
  const meta = await discover(io.fetch, baseUrl);

  let clientId = opts.reregister ? null : await readCachedClientId(dir, meta.issuer);
  if (!clientId) {
    clientId = await registerClient(io.fetch, meta);
    await writeCachedClientId(dir, meta.issuer, clientId);
  }

  const pkce = createPkce();
  const state = randomState();
  const loop = await startLoopback({ state, issuer: meta.issuer });
  try {
    const url = buildAuthorizeUrl(meta, { clientId, redirectUri: loop.redirectUri, state, challenge: pkce.challenge });
    const opened = opts.browser === false ? false : await io.openBrowser(url);
    io.err(opened ? 'Opened your browser to sign in to Rightis.' : 'Open this URL in your browser to sign in to Rightis:');
    io.err(opened ? `If it did not open, visit: ${url}` : url);
    io.err('Waiting for the browser...');

    let code: string;
    try {
      code = await loop.code;
    } catch (e) {
      if (e instanceof LoopbackError && e.reason === 'timeout') {
        throw new CliError(
          'Timed out waiting for the browser. If the page said the client is unknown, run: rightis login --reregister',
        );
      }
      throw new CliError(`Login failed: ${(e as Error).message}`);
    }

    let tokens: TokenResponse;
    try {
      tokens = await exchangeCode(io.fetch, meta.token_endpoint, { code, verifier: pkce.verifier, redirectUri: loop.redirectUri, clientId });
    } catch (e) {
      if (e instanceof RightisError && e.code === 'invalid_client') await writeCachedClientId(dir, meta.issuer, null);
      throw e;
    }
    const creds = toCredentials(tokens, { clientId, baseUrl, meta }, io.now());
    await writeCredentials(dir, creds);
    return creds;
  } finally {
    loop.close();
  }
}

/**
 * A valid access token for `baseUrl`, refreshing (and storing the rotated
 * refresh token) when it is within a minute of expiring.
 */
export async function getAccessToken(io: Io, baseUrl: string): Promise<string> {
  const dir = configDir(io.env);
  const creds = await readCredentials(dir);
  if (!creds) throw new CliError('Not logged in. Run: npx rightis login');
  if (creds.base_url !== baseUrl) {
    throw new CliError(`Logged in to ${creds.base_url}, not ${baseUrl}. Run: npx rightis login --base-url ${baseUrl}`);
  }
  if (Date.parse(creds.expires_at) - REFRESH_SKEW_MS > io.now()) return creds.access_token;

  let tokens: TokenResponse;
  try {
    tokens = await refreshTokens(io.fetch, creds.token_endpoint, { refreshToken: creds.refresh_token, clientId: creds.client_id });
  } catch (e) {
    if (e instanceof RightisError && (e.code === 'invalid_grant' || e.status === 401)) {
      await deleteCredentials(dir);
      throw new CliError('Your session has expired. Run: npx rightis login');
    }
    throw e;
  }
  const next = toCredentials(
    tokens,
    { clientId: creds.client_id, baseUrl, meta: { token_endpoint: creds.token_endpoint, revocation_endpoint: creds.revocation_endpoint } },
    io.now(),
  );
  await writeCredentials(dir, next);
  return next.access_token;
}
