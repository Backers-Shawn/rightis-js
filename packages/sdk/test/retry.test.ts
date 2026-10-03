import { describe, expect, it } from 'vitest';

import { Rightis } from '../src/index.js';
import { NOT_REGISTERED, SANDBOX_KEY, fakeFetch, json } from './helpers.js';

function recorder() {
  const waits: number[] = [];
  return { waits, internal: { sleep: async (ms: number) => void waits.push(ms), random: () => 0 } };
}

const rateLimited = (retryAfter?: string) =>
  json(429, { error: { code: 'RATE_LIMITED', message: 'slow down', details: null }, request_id: null }, retryAfter ? { 'retry-after': retryAfter } : {});
const unavailable = () => json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down', details: null } });

describe('retry policy', () => {
  it('retries a GET on 503 and on network errors, with backoff', async () => {
    const { waits, internal } = recorder();
    const { fetch, calls } = fakeFetch([unavailable(), new TypeError('fetch failed'), json(200, { people: [] })]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch }, internal);
    await expect(rightis.sandbox.people()).resolves.toEqual({ people: [] });
    expect(calls).toHaveLength(3);
    // random() = 0 gives half the base: 500ms then 1000ms halved.
    expect(waits).toEqual([250, 500]);
  });

  it('respects Retry-After on 429', async () => {
    const { waits, internal } = recorder();
    const { fetch, calls } = fakeFetch([rateLimited('2'), json(200, { query: 'a', count: 0, data: [] })]);
    await new Rightis({ apiKey: null, fetch }, internal).rights.search('a');
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('does not wait out a Retry-After longer than 60 seconds', async () => {
    const { waits, internal } = recorder();
    const { fetch, calls } = fakeFetch([rateLimited('3600')]);
    await expect(new Rightis({ apiKey: null, fetch }, internal).rights.search('a')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 3600,
    });
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('stops after maxRetries and returns the last error', async () => {
    const { internal } = recorder();
    const { fetch, calls } = fakeFetch([unavailable(), unavailable(), unavailable()]);
    await expect(new Rightis({ apiKey: null, fetch, maxRetries: 2 }, internal).rights.lookup('BR-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
    expect(calls).toHaveLength(3);
  });

  it('never retries a non-idempotent POST (keyed check is billed, licence request writes)', async () => {
    const { internal } = recorder();
    const a = fakeFetch([unavailable()]);
    await expect(new Rightis({ apiKey: SANDBOX_KEY, fetch: a.fetch }, internal).rights.check({ rights_id: 'BR-1234567890' })).rejects.toMatchObject({ status: 503 });
    expect(a.calls).toHaveLength(1);

    const b = fakeFetch([rateLimited('1')]);
    await expect(new Rightis({ apiKey: SANDBOX_KEY, fetch: b.fetch }, internal).licenses.verify({ license_public_code: 'L-1' })).rejects.toMatchObject({ status: 429 });
    expect(b.calls).toHaveLength(1);

    const c = fakeFetch([new TypeError('fetch failed')]);
    await expect(
      new Rightis({ apiKey: SANDBOX_KEY, fetch: c.fetch }, internal).licenses.request({} as never),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(c.calls).toHaveLength(1);
  });

  it('retries the keyless resolve (a read with no side effects)', async () => {
    const { internal } = recorder();
    const { fetch, calls } = fakeFetch([unavailable(), json(200, NOT_REGISTERED)]);
    await new Rightis({ apiKey: null, fetch }, internal).rights.check({ rights_id: 'BR-0000-0000-0000' });
    expect(calls).toHaveLength(2);
  });

  it('retries usage.log, which the server dedupes on event_id', async () => {
    const { internal } = recorder();
    const { fetch, calls } = fakeFetch([unavailable(), json(200, { received: 1, recorded: 0, duplicates: 1, rejected: 0, results: [] })]);
    const result = await new Rightis({ apiKey: SANDBOX_KEY, fetch }, internal).usage.log([
      { event_id: 'e1', license_public_code: 'L-1', occurred_at: '2026-10-03T00:00:00Z', use_type: 'generation', decision: 'allow' },
    ]);
    expect(result.duplicates).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toEqual(calls[1]!.body);
  });

  it('does not retry 4xx other than 429', async () => {
    const { internal } = recorder();
    const { fetch, calls } = fakeFetch([json(404, { error: { code: 'NOT_FOUND', message: 'nope' } })]);
    await expect(new Rightis({ apiKey: null, fetch }, internal).rights.lookup('BR-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });
});
