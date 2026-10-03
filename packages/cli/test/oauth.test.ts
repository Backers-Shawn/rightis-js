import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { credentialsPath, readCachedClientId, readCredentials, writeCredentials } from '../src/credentials.js';
import { main } from '../src/main.js';
import { getAccessToken } from '../src/oauth.js';
import { fakeIo, json, routedFetch, tempDir, type Call } from './helpers.js';

const BASE = 'https://rightis.org';
const META = {
  issuer: BASE,
  authorization_endpoint: `${BASE}/oauth/authorize`,
  token_endpoint: `${BASE}/api/oauth/token`,
  registration_endpoint: `${BASE}/api/oauth/register`,
  revocation_endpoint: `${BASE}/api/oauth/revoke`,
};

const form = (c: Call) => Object.fromEntries(new URLSearchParams(c.body ?? ''));

describe('login', () => {
  it('discovers, registers, authorizes with PKCE on a loopback port, exchanges and stores 0600 credentials', async () => {
    const config = await tempDir('rightis-config-');
    let challenge = '';
    const { fetch, calls } = routedFetch({
      'GET /.well-known/oauth-authorization-server': () => json(200, META),
      'POST /api/oauth/register': (c) => {
        const body = JSON.parse(c.body!);
        expect(body.redirect_uris).toEqual(['http://127.0.0.1/callback']);
        expect(body.token_endpoint_auth_method).toBe('none');
        expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
        expect(body.scope).toBe('console:manage rights:check');
        return json(201, { client_id: 'cid-1' });
      },
      'POST /api/oauth/token': async (c) => {
        const f = form(c);
        expect(f.grant_type).toBe('authorization_code');
        expect(f.code).toBe('auth-code');
        expect(f.client_id).toBe('cid-1');
        expect(f.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        const { challengeFor } = await import('../src/oauth.js');
        expect(challengeFor(f.code_verifier!)).toBe(challenge);
        return json(200, { access_token: 'rat_new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rrt_new', scope: 'console:manage rights:check' });
      },
    });
    // The "browser": follow the authorize URL straight to the loopback redirect.
    const openBrowser = async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      challenge = u.searchParams.get('code_challenge')!;
      const redirect = new URL(u.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('code', 'auth-code');
      redirect.searchParams.set('state', u.searchParams.get('state')!);
      void globalThis.fetch(redirect);
      return true;
    };
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config }, fetch, openBrowser });
    expect(await main(['login'], io)).toBe(0);
    expect(io.stdout.join('\n')).toContain('Logged in to https://rightis.org.');
    expect(io.all()).not.toContain('rat_new');
    expect(io.all()).not.toContain('rrt_new');
    const creds = await readCredentials(config);
    expect(creds).toMatchObject({ access_token: 'rat_new', refresh_token: 'rrt_new', client_id: 'cid-1', base_url: BASE, expires_at: '2026-10-03T01:00:00.000Z' });
    expect((await stat(credentialsPath(config))).mode & 0o777).toBe(0o600);
    expect(await readCachedClientId(config, BASE)).toBe('cid-1');
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /.well-known/oauth-authorization-server',
      'POST /api/oauth/register',
      'POST /api/oauth/token',
    ]);
  });

  it('refuses metadata whose issuer is not the base URL', async () => {
    const { fetch } = routedFetch({ 'GET /.well-known/oauth-authorization-server': () => json(200, { ...META, issuer: 'https://evil.example' }) });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: await tempDir() }, fetch });
    expect(await main(['login'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('Issuer mismatch');
  });
});

describe('token refresh', () => {
  const stored = {
    access_token: 'rat_old',
    refresh_token: 'rrt_old',
    client_id: 'cid',
    base_url: BASE,
    token_endpoint: META.token_endpoint,
    revocation_endpoint: META.revocation_endpoint,
  };

  it('returns a fresh token without calling the server', async () => {
    const config = await tempDir();
    await writeCredentials(config, { ...stored, expires_at: '2026-10-03T00:30:00.000Z' });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config } });
    expect(await getAccessToken(io, BASE)).toBe('rat_old');
  });

  it('refreshes an expiring token and stores the rotated refresh token', async () => {
    const config = await tempDir();
    await writeCredentials(config, { ...stored, expires_at: '2026-10-03T00:00:30.000Z' });
    const { fetch, calls } = routedFetch({
      'POST /api/oauth/token': () => json(200, { access_token: 'rat_2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rrt_2' }),
    });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config }, fetch });
    expect(await getAccessToken(io, BASE)).toBe('rat_2');
    expect(form(calls[0]!)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rrt_old', client_id: 'cid' });
    expect(await readCredentials(config)).toMatchObject({ access_token: 'rat_2', refresh_token: 'rrt_2' });
    expect((await stat(credentialsPath(config))).mode & 0o777).toBe(0o600);
  });

  it('asks to log in again when the refresh token is rejected', async () => {
    const config = await tempDir();
    await writeCredentials(config, { ...stored, expires_at: '2026-10-02T00:00:00.000Z' });
    const { fetch } = routedFetch({ 'POST /api/oauth/token': () => json(400, { error: 'invalid_grant', error_description: 'revoked' }) });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config }, fetch });
    await expect(getAccessToken(io, BASE)).rejects.toThrow(/rightis login/);
    expect(await readCredentials(config)).toBeNull();
  });

  it('refuses a token stored for another server', async () => {
    const config = await tempDir();
    await writeCredentials(config, { ...stored, expires_at: '2026-10-03T00:30:00.000Z' });
    await expect(getAccessToken(fakeIo({ env: { RIGHTIS_CONFIG_DIR: config } }), 'http://localhost:3000')).rejects.toThrow(/Logged in to https:\/\/rightis.org/);
  });
});

describe('logout', () => {
  it('revokes both tokens and deletes the file', async () => {
    const config = await tempDir();
    await writeCredentials(config, {
      access_token: 'rat_a',
      refresh_token: 'rrt_r',
      expires_at: '2026-10-03T00:30:00.000Z',
      client_id: 'cid',
      base_url: BASE,
      token_endpoint: META.token_endpoint,
      revocation_endpoint: META.revocation_endpoint,
    });
    const { fetch, calls } = routedFetch({ 'POST /api/oauth/revoke': () => new Response(null, { status: 200 }) });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config }, fetch });
    expect(await main(['logout'], io)).toBe(0);
    expect(calls.map((c) => form(c).token_type_hint)).toEqual(['refresh_token', 'access_token']);
    expect(calls.every((c) => form(c).client_id === 'cid')).toBe(true);
    expect(await readCredentials(config)).toBeNull();
  });

  it('still deletes the file when the server cannot be reached', async () => {
    const config = await tempDir();
    await writeCredentials(config, {
      access_token: 'rat_a',
      refresh_token: 'rrt_r',
      expires_at: '2026-10-03T00:30:00.000Z',
      client_id: 'cid',
      base_url: BASE,
      token_endpoint: META.token_endpoint,
      revocation_endpoint: META.revocation_endpoint,
    });
    const io = fakeIo({ env: { RIGHTIS_CONFIG_DIR: config } });
    expect(await main(['logout'], io)).toBe(0);
    expect(io.stderr.join('\n')).toContain('Warning');
    expect(await readCredentials(config)).toBeNull();
  });
});
