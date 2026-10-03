import { describe, expect, it } from 'vitest';

import { Rightis, RightisError, errorFromResponseBody, parseRetryAfter } from '../src/index.js';
import { SANDBOX_KEY, fakeFetch, json, noSleep } from './helpers.js';

describe('error envelope parsing', () => {
  it('reads code, message, details and request_id from the API envelope', () => {
    const err = errorFromResponseBody(
      402,
      JSON.stringify({
        error: { code: 'INSUFFICIENT_CREDIT', message: 'Top up', details: { balance: '0' } },
        request_id: 'req_123',
      }),
    );
    expect(err).toBeInstanceOf(RightisError);
    expect(err.code).toBe('INSUFFICIENT_CREDIT');
    expect(err.status).toBe(402);
    expect(err.message).toBe('Top up');
    expect(err.details).toEqual({ balance: '0' });
    expect(err.requestId).toBe('req_123');
  });

  it('falls back to the x-request-id header when the body has null', () => {
    const err = errorFromResponseBody(
      401,
      JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', details: null }, request_id: null }),
      new Headers({ 'x-request-id': 'hdr_1' }),
    );
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.requestId).toBe('hdr_1');
    expect(err.details).toBeNull();
  });

  it('reads OAuth-style errors', () => {
    const err = errorFromResponseBody(400, JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }));
    expect(err.code).toBe('invalid_grant');
    expect(err.message).toBe('expired');
  });

  it('turns a non-JSON body into HTTP_<status>', () => {
    const err = errorFromResponseBody(502, '<html>Bad gateway</html>');
    expect(err.code).toBe('HTTP_502');
    expect(err.status).toBe(502);
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    const err = errorFromResponseBody(
      429,
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down' } }),
      new Headers({ 'retry-after': '3' }),
    );
    expect(err.retryAfterSeconds).toBe(3);
  });

  it('surfaces 402 from a real call without retrying, and never puts the key in the error', async () => {
    const { fetch, calls } = fakeFetch([
      json(402, { error: { code: 'INSUFFICIENT_CREDIT', message: 'No credit left', details: null }, request_id: 'r1' }),
    ]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch }, noSleep);
    const err = await rightis.rights.check({ rights_id: 'BR-0000-0000-0000' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RightisError);
    expect((err as RightisError).code).toBe('INSUFFICIENT_CREDIT');
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(err)).not.toContain(SANDBOX_KEY);
    expect(String((err as Error).message)).not.toContain(SANDBOX_KEY);
  });

  it('wraps network failures as NETWORK_ERROR', async () => {
    const { fetch } = fakeFetch([new TypeError('fetch failed')]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch }, noSleep);
    await expect(rightis.licenses.verify({ license_public_code: 'L-1' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });

  it('times out with TIMEOUT', async () => {
    const fetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch, timeoutMs: 10, maxRetries: 0 });
    await expect(rightis.rights.check({ rights_id: 'BR-0000-0000-0000' })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
