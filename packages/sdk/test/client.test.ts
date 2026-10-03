import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Rightis, RightisError, SDK_VERSION, keyEnvironment } from '../src/index.js';
import { NOT_REGISTERED, SANDBOX_KEY, fakeFetch, json, noSleep } from './helpers.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rights.check routing', () => {
  it('uses the keyless public resolve when no key is configured, sending only Resolve fields', async () => {
    vi.stubEnv('RIGHTIS_SECRET_KEY', '');
    const { fetch, calls } = fakeFetch([json(200, NOT_REGISTERED)]);
    const rightis = new Rightis({ fetch });
    expect(rightis.hasApiKey).toBe(false);
    const result = await rightis.rights.check({
      rights_id: 'BR-0000-0000-0000',
      use_type: 'instagram ad',
      asset_types: ['face'],
      requested_categories: ['face'],
    });
    expect(result.next_action.type).toBe('not_registered');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://rightis.org/api/public/v1/rights/resolve');
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.body).toEqual({ rights_id: 'BR-0000-0000-0000', use_type: 'instagram ad', asset_types: ['face'] });
  });

  it('uses the keyed check with a Bearer key, passing legacy fields through', async () => {
    const { fetch, calls } = fakeFetch([json(200, { ...NOT_REGISTERED, rights_status: 'unknown' })]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch });
    expect(rightis.environment).toBe('sandbox');
    const result = await rightis.rights.check({ rights_id: 'BR-0000-0000-0000', requested_categories: ['face'] });
    expect(result.rights_status).toBe('unknown');
    expect(calls[0]!.url).toBe('https://rightis.org/api/v1/rights/check');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SANDBOX_KEY}`);
    expect(calls[0]!.body).toEqual({ rights_id: 'BR-0000-0000-0000', requested_categories: ['face'] });
  });

  it('reads RIGHTIS_SECRET_KEY and RIGHTIS_API_URL from the environment', async () => {
    vi.stubEnv('RIGHTIS_SECRET_KEY', SANDBOX_KEY);
    vi.stubEnv('RIGHTIS_API_URL', 'http://localhost:3000/');
    const { fetch, calls } = fakeFetch([json(200, NOT_REGISTERED)]);
    const rightis = new Rightis({ fetch });
    await rightis.rights.check({ rights_id: 'BR-0000-0000-0000' });
    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/rights/check');
  });

  it('apiKey: null forces the public path even when the env var is set', async () => {
    vi.stubEnv('RIGHTIS_SECRET_KEY', SANDBOX_KEY);
    const { fetch, calls } = fakeFetch([json(200, NOT_REGISTERED)]);
    await new Rightis({ apiKey: null, fetch }).rights.check({ rights_id: 'BR-0000-0000-0000' });
    expect(calls[0]!.url).toContain('/api/public/v1/rights/resolve');
  });

  it('refuses to send a key over plain http to a non-local host', () => {
    expect(() => new Rightis({ apiKey: SANDBOX_KEY, baseUrl: 'http://example.com' })).toThrow(RightisError);
    expect(() => new Rightis({ apiKey: null, baseUrl: 'http://example.com' })).not.toThrow();
  });

  it('does not expose the key when the client is serialised', () => {
    const rightis = new Rightis({ apiKey: SANDBOX_KEY });
    expect(JSON.stringify(rightis)).not.toContain(SANDBOX_KEY);
  });

  it('requires rights_id before calling the network', async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(new Rightis({ apiKey: null, fetch }).rights.check({ rights_id: ' ' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('other resources', () => {
  it('lookup and search hit the keyless GET endpoints', async () => {
    const { fetch, calls } = fakeFetch([
      json(200, { registered: false, rights_id: 'BR-1', message: 'x', register_url: 'y' }),
      json(200, { query: 'kim', count: 0, data: [] }),
    ]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch });
    await rightis.rights.lookup('BR-0000-0000-0000');
    await rightis.rights.search('kim', { limit: 5 });
    expect(calls[0]!.url).toBe('https://rightis.org/api/public/v1/rights/lookup?rights_id=BR-0000-0000-0000');
    expect(calls[1]!.url).toBe('https://rightis.org/api/public/v1/rights/search?q=kim&limit=5');
    // Keyless endpoints do not need the key; do not send it.
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('keyed resources fail fast without a key', async () => {
    const { fetch, calls } = fakeFetch([]);
    const rightis = new Rightis({ apiKey: null, fetch });
    await expect(rightis.sandbox.people()).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    await expect(rightis.licenses.verify({ license_public_code: 'L-1' })).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    expect(calls).toHaveLength(0);
  });

  it('usage.log wraps events and enforces the batch bounds', async () => {
    const { fetch, calls } = fakeFetch([json(200, { received: 1, recorded: 1, duplicates: 0, rejected: 0, results: [] })]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch });
    const event = {
      event_id: 'e1',
      license_public_code: 'L-1',
      occurred_at: '2026-10-03T00:00:00Z',
      use_type: 'generation' as const,
      decision: 'allow' as const,
    };
    await rightis.usage.log([event]);
    expect(calls[0]!.url).toBe('https://rightis.org/api/v1/usage');
    expect(calls[0]!.body).toEqual({ events: [event] });
    await expect(rightis.usage.log([])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(rightis.usage.log(Array.from({ length: 501 }, () => event))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('sandbox.people and licenses.request call their routes', async () => {
    const { fetch, calls } = fakeFetch([json(200, { people: [] }), json(201, { license_request_id: 'lr_1' })]);
    const rightis = new Rightis({ apiKey: SANDBOX_KEY, fetch }, noSleep);
    await rightis.sandbox.people();
    await rightis.licenses.request({
      rights_id: 'BR-0000-0000-0000',
      campaign_name: 'c',
      description: 'd',
      usage_type: 'social_media_ad',
      media_types: ['instagram'],
      territory: ['KR'],
      duration_start: '2026-10-03T00:00:00Z',
      duration_end: '2026-11-03T00:00:00Z',
      rights_categories: ['face'],
      ai_generation_methods: ['image_generation'],
      proposed_fee: '500000',
      currency_code: 'KRW',
    });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v1/sandbox/people',
      'POST /api/v1/licenses/requests',
    ]);
  });
});

describe('misc', () => {
  it('keyEnvironment reads the prefix', () => {
    expect(keyEnvironment('brk_test_x')).toBe('sandbox');
    expect(keyEnvironment('brk_live_x')).toBe('production');
    expect(keyEnvironment('rat_x')).toBeNull();
  });

  it('SDK_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('exports no convenience boolean that turns allowed into permission', async () => {
    const mod = (await import('../src/index.js')) as Record<string, unknown>;
    const names = Object.keys(mod).map((n) => n.toLowerCase());
    for (const banned of ['isallowed', 'canuse', 'guard', 'mayuse', 'isclear', 'iscleared']) {
      expect(names).not.toContain(banned);
    }
  });
});
