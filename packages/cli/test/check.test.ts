import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { main } from '../src/main.js';
import { fakeIo, json, routedFetch, tempDir } from './helpers.js';

const REGISTERED = {
  rights_id: 'BR-AAAA-BBBB-CCCC',
  registered: true,
  identity: { display_name: 'Sample', display_name_en: null, managed_by: null, identity_verified: true, country_code: 'KR' },
  decision: 'allowed',
  scopes: [{ scope: 'ai_image_generation', state: 'allowed' }],
  unmapped: [],
  training: { decision: 'requires_approval', do_not_train: true },
  next_action: { type: 'request_license', url: 'https://rightis.org/r/x/request', reason: 'Still request it.', auto_approves: true },
  profile_url: 'https://rightis.org/r/x',
  notes: [],
};

describe('rightis check', () => {
  it('uses the public resolve without a key and prints decision, next action and scopes', async () => {
    const { fetch, calls } = routedFetch({ 'POST /api/public/v1/rights/resolve': () => json(200, REGISTERED) });
    const io = fakeIo({ cwd: await tempDir(), fetch });
    expect(await main(['check', 'BR-AAAA-BBBB-CCCC', '--use', 'instagram ad', '--asset', 'face', '--asset', 'face', '--training'], io)).toBe(0);
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      rights_id: 'BR-AAAA-BBBB-CCCC',
      use_type: 'instagram ad',
      asset_types: ['face'],
      for_training: true,
    });
    const out = io.stdout.join('\n');
    expect(out).toMatch(/decision\s+allowed/);
    expect(out).toMatch(/next action\s+request_license\s+https:\/\/rightis\.org\/r\/x\/request/);
    expect(out).toMatch(/ai_image_generation\s+allowed/);
    expect(out).toContain('allowed is not free use');
    expect(out).toContain('public resolve (no API key)');
  });

  it('exits 0 for denied and not_registered: a decision is information', async () => {
    const denied = { ...REGISTERED, decision: 'denied', next_action: { type: 'stop', url: null, reason: 'Refused.' } };
    const a = routedFetch({ 'POST /api/public/v1/rights/resolve': () => json(200, denied) });
    expect(await main(['check', 'BR-AAAA-BBBB-CCCC', '--use', 'x'], fakeIo({ cwd: await tempDir(), fetch: a.fetch }))).toBe(0);
  });

  it('prints raw JSON with --json', async () => {
    const { fetch } = routedFetch({ 'POST /api/public/v1/rights/resolve': () => json(200, REGISTERED) });
    const io = fakeIo({ cwd: await tempDir(), fetch });
    expect(await main(['check', 'BR-AAAA-BBBB-CCCC', '--json'], io)).toBe(0);
    expect(JSON.parse(io.stdout.join('\n'))).toEqual(REGISTERED);
  });

  it('uses the keyed check with a key from .env.local, and --public ignores it', async () => {
    const cwd = await tempDir();
    const key = 'brk_test_0123456789ABCDEFGHIJKL.0123456789abcdefghijklmnopqrstuv';
    await writeFile(join(cwd, '.env.local'), `RIGHTIS_SECRET_KEY=${key}\n`);
    const { fetch, calls } = routedFetch({
      'POST /api/v1/rights/check': () => json(200, REGISTERED),
      'POST /api/public/v1/rights/resolve': () => json(200, REGISTERED),
    });
    const io = fakeIo({ cwd, fetch });
    expect(await main(['check', 'BR-AAAA-BBBB-CCCC'], io)).toBe(0);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${key}`);
    expect(io.all()).not.toContain(key);
    expect(io.stdout.join('\n')).toContain('keyed check (sandbox key from .env.local)');
    expect(await main(['check', 'BR-AAAA-BBBB-CCCC', '--public'], fakeIo({ cwd, fetch }))).toBe(0);
    expect(new URL(calls[1]!.url).pathname).toBe('/api/public/v1/rights/resolve');
    expect(calls[1]!.headers.authorization).toBeUndefined();
  });

  it('exits 1 with the server error code on failure', async () => {
    const { fetch } = routedFetch({
      'POST /api/public/v1/rights/resolve': () =>
        json(400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: null }, request_id: 'req_9' }),
    });
    const io = fakeIo({ cwd: await tempDir(), fetch });
    expect(await main(['check', 'BR-1'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('VALIDATION_ERROR');
    expect(io.stderr.join('\n')).toContain('req_9');
  });
});

describe('rightis people', () => {
  it('refuses a production key', async () => {
    const io = fakeIo({ cwd: await tempDir(), env: { RIGHTIS_SECRET_KEY: 'brk_live_x.y' } });
    expect(await main(['people'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('not a sandbox key');
  });

  it('lists the sandbox people', async () => {
    const { fetch } = routedFetch({
      'GET /api/v1/sandbox/people': () =>
        json(200, { people: [{ rights_id: 'BR-SBX1-AAAA-0001', display_name: 'Sample One', preset: 'fully_approved', summary: 'All pre-authorised' }] }),
    });
    const io = fakeIo({ cwd: await tempDir(), env: { RIGHTIS_SECRET_KEY: 'brk_test_x.y' }, fetch });
    expect(await main(['people'], io)).toBe(0);
    expect(io.stdout.join('\n')).toMatch(/BR-SBX1-AAAA-0001\s+Sample One\s+fully_approved/);
    expect(io.all()).not.toContain('brk_test_x.y');
  });
});
