import { describe, expect, it } from 'vitest';

import { LoopbackError, startLoopback } from '../src/loopback.js';

async function hit(redirectUri: string, query: string, path = '/callback') {
  const url = new URL(redirectUri);
  url.pathname = path;
  url.search = query;
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

describe('loopback callback server', () => {
  it('listens on 127.0.0.1 on a free port and resolves with the code', async () => {
    const loop = await startLoopback({ state: 'abc', issuer: 'https://rightis.org' });
    expect(loop.redirectUri).toBe(`http://127.0.0.1:${loop.port}/callback`);
    expect(loop.port).toBeGreaterThan(0);
    const res = await hit(loop.redirectUri, '?code=the-code&state=abc&iss=https%3A%2F%2Frightis.org');
    expect(res.status).toBe(200);
    expect(res.text).toContain('login complete');
    await expect(loop.code).resolves.toBe('the-code');
  });

  it('rejects a state mismatch and does not hand out the code', async () => {
    const loop = await startLoopback({ state: 'expected' });
    const res = await hit(loop.redirectUri, '?code=stolen&state=attacker');
    expect(res.status).toBe(400);
    await expect(loop.code).rejects.toMatchObject({ reason: 'state_mismatch' });
    await expect(loop.code).rejects.toBeInstanceOf(LoopbackError);
  });

  it('rejects a missing state', async () => {
    const loop = await startLoopback({ state: 'expected' });
    await hit(loop.redirectUri, '?code=x');
    await expect(loop.code).rejects.toMatchObject({ reason: 'state_mismatch' });
  });

  it('rejects a response from another issuer', async () => {
    const loop = await startLoopback({ state: 's', issuer: 'https://rightis.org' });
    await hit(loop.redirectUri, '?code=x&state=s&iss=https%3A%2F%2Fevil.example');
    await expect(loop.code).rejects.toMatchObject({ reason: 'issuer_mismatch' });
  });

  it('reports an authorization error from the server', async () => {
    const loop = await startLoopback({ state: 's' });
    const res = await hit(loop.redirectUri, '?error=access_denied&error_description=User%20declined&state=s');
    expect(res.status).toBe(400);
    await expect(loop.code).rejects.toMatchObject({ reason: 'authorization_error', message: 'access_denied: User declined' });
  });

  it('ignores other paths without settling', async () => {
    const loop = await startLoopback({ state: 's' });
    expect((await hit(loop.redirectUri, '', '/favicon.ico')).status).toBe(404);
    expect((await hit(loop.redirectUri, '?code=c&state=s')).status).toBe(200);
    await expect(loop.code).resolves.toBe('c');
  });

  it('times out', async () => {
    const loop = await startLoopback({ state: 's', timeoutMs: 20 });
    await expect(loop.code).rejects.toMatchObject({ reason: 'timeout' });
  });
});
