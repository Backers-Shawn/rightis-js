import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeCredentials } from '../src/credentials.js';
import { main } from '../src/main.js';
import { SECRET, fakeIo, json, routedFetch, tempDir, tempRepo } from './helpers.js';

const BASE = 'https://rightis.org';
const KEY = { id: 'k1', key_id_public: 'PUBLICKEYID0000000000AA', environment: 'sandbox', status: 'active', scopes: ['rights:check'], label: 'rightis init', created_at: '2026-10-03T00:00:00Z', last_used_at: null };

async function loggedIn(): Promise<string> {
  const configDir = await tempDir('rightis-config-');
  await writeCredentials(configDir, {
    access_token: 'rat_valid',
    refresh_token: 'rrt_valid',
    expires_at: '2026-10-03T01:00:00.000Z',
    client_id: 'cid',
    base_url: BASE,
    token_endpoint: `${BASE}/api/oauth/token`,
    revocation_endpoint: `${BASE}/api/oauth/revoke`,
  });
  return configDir;
}

function server(opts: { organization: boolean }) {
  return routedFetch({
    'GET /api/v1/console': (c) => {
      expect(c.headers.authorization).toBe('Bearer rat_valid');
      return json(200, {
        organization: opts.organization ? { id: 'o1', name: 'Acme', status: 'active' } : null,
        apps: [],
        production_unlocked: false,
        keys: [],
      });
    },
    'POST /api/v1/console/setup': () => json(201, { organization_id: 'o1', created: true }),
    'POST /api/v1/console/keys': () => json(201, { key: KEY, secret: SECRET }),
    'GET /api/v1/sandbox/people': (c) => {
      expect(c.headers.authorization).toBe(`Bearer ${SECRET}`);
      return json(200, { people: [{ rights_id: 'BR-SBX1-AAAA-0001', display_name: 'Sample One', preset: 'fully_approved', summary: 'Everything pre-authorised' }] });
    },
  });
}

describe('rightis init', () => {
  it('sets up the org, writes the key to .env.local, writes the example, and never prints the secret', async () => {
    const cwd = await tempRepo('.env.local\n');
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: '@acme/gen-app' }));
    const { fetch, calls } = server({ organization: false });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });

    expect(await main(['init', '--yes'], io)).toBe(0);

    const out = io.all();
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(SECRET.split('.')[1]);
    expect(out).toContain('Wrote RIGHTIS_SECRET_KEY to .env.local');
    expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(`RIGHTIS_SECRET_KEY=${SECRET}\n`);
    expect((await stat(join(cwd, '.env.local'))).mode & 0o777).toBe(0o600);

    const setup = calls.find((c) => c.url.endsWith('/console/setup'))!;
    expect(JSON.parse(setup.body!)).toEqual({ organization_name: 'gen-app', use_case: 'generation_gate' });
    const keys = calls.find((c) => c.url.endsWith('/console/keys'))!;
    expect(JSON.parse(keys.body!)).toMatchObject({ environment: 'sandbox' });

    const example = await readFile(join(cwd, 'rightis-example.mjs'), 'utf8');
    expect(example).toContain("rights_id: 'BR-SBX1-AAAA-0001'");
    expect(example).not.toContain(SECRET);
    expect(example).toContain('not free use');
    expect(out).toContain('npx rightis check BR-SBX1-AAAA-0001');
  });

  it('refuses before creating any key when .env.local is not ignored', async () => {
    const cwd = await tempRepo('node_modules\n');
    const { fetch, calls } = server({ organization: true });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });
    expect(await main(['init', '--yes'], io)).toBe(1);
    expect(calls).toHaveLength(0);
    expect(io.stderr.join('\n')).toContain('.gitignore');
  });

  it('refuses outside a git repository', async () => {
    const cwd = await tempDir();
    const { fetch, calls } = server({ organization: true });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });
    expect(await main(['init', '--yes'], io)).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it('does not overwrite an existing key without --force, and replaces it with --force', async () => {
    const cwd = await tempRepo('.env.local\n');
    await writeFile(join(cwd, '.env.local'), 'RIGHTIS_SECRET_KEY=brk_test_old\n');
    const first = server({ organization: true });
    const config = await loggedIn();
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: config }, fetch: first.fetch });
    expect(await main(['init', '--yes'], io)).toBe(1);
    expect(first.calls).toHaveLength(0);
    expect(await readFile(join(cwd, '.env.local'), 'utf8')).toContain('brk_test_old');

    const second = server({ organization: true });
    const io2 = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: config }, fetch: second.fetch });
    expect(await main(['init', '--yes', '--force'], io2)).toBe(0);
    expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(`RIGHTIS_SECRET_KEY=${SECRET}\n`);
    expect(io2.all()).not.toContain(SECRET);
    // Existing organization: no setup call.
    expect(second.calls.some((c) => c.url.endsWith('/console/setup'))).toBe(false);
  });

  it('writes a Next.js route handler under src/app when --framework next', async () => {
    const cwd = await tempRepo('.env.local\n');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, 'src', 'app'), { recursive: true });
    const { fetch } = server({ organization: true });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });
    expect(await main(['init', '--yes', '--framework', 'next'], io)).toBe(0);
    const route = await readFile(join(cwd, 'src', 'app', 'api', 'rightis-check', 'route.ts'), 'utf8');
    expect(route).toContain('export async function POST');
    expect(route).toContain('BR-SBX1-AAAA-0001');
  });

  it('asks for --org-name or --yes when it cannot prompt', async () => {
    const cwd = await tempRepo('.env.local\n');
    const { fetch, calls } = server({ organization: false });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });
    expect(await main(['init'], io)).toBe(2);
    expect(calls.some((c) => c.url.endsWith('/console/keys'))).toBe(false);
  });

  it('says plainly when the server has no console API yet', async () => {
    const cwd = await tempRepo('.env.local\n');
    const { fetch } = routedFetch({ 'GET /api/v1/console': () => json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } }) });
    const io = fakeIo({ cwd, env: { RIGHTIS_CONFIG_DIR: await loggedIn() }, fetch });
    expect(await main(['init', '--yes'], io)).toBe(1);
    expect(io.stderr.join('\n')).toContain('does not have the console API yet');
  });
});
