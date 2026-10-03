import { chmod, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  credentialsPath,
  deleteCredentials,
  readCachedClientId,
  readCredentials,
  writeCachedClientId,
  writeCredentials,
  type Credentials,
} from '../src/credentials.js';
import { tempDir } from './helpers.js';

const CREDS: Credentials = {
  access_token: 'rat_access',
  refresh_token: 'rrt_refresh',
  expires_at: '2026-10-03T01:00:00.000Z',
  client_id: 'client-1',
  base_url: 'https://rightis.org',
  token_endpoint: 'https://rightis.org/api/oauth/token',
  revocation_endpoint: 'https://rightis.org/api/oauth/revoke',
};

const mode = async (p: string) => (await stat(p)).mode & 0o777;

describe('credentials file', () => {
  it('creates the directory 0700 and the file 0600', async () => {
    const dir = join(await tempDir(), 'nested', 'rightis');
    await writeCredentials(dir, CREDS);
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(credentialsPath(dir))).toBe(0o600);
    expect(await readCredentials(dir)).toEqual(CREDS);
  });

  it('keeps 0600 when overwriting and tightens a loose existing directory', async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    await writeCredentials(dir, CREDS);
    await chmod(credentialsPath(dir), 0o644);
    await writeCredentials(dir, { ...CREDS, refresh_token: 'rrt_rotated' });
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(credentialsPath(dir))).toBe(0o600);
    expect((await readCredentials(dir))?.refresh_token).toBe('rrt_rotated');
  });

  it('leaves no temp files behind', async () => {
    const dir = await tempDir();
    await writeCredentials(dir, CREDS);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['credentials.json']);
  });

  it('reads nothing when absent or corrupt, and deletes cleanly', async () => {
    const dir = await tempDir();
    expect(await readCredentials(dir)).toBeNull();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(credentialsPath(dir), '{not json');
    expect(await readCredentials(dir)).toBeNull();
    await writeCredentials(dir, CREDS);
    await deleteCredentials(dir);
    expect(await readCredentials(dir)).toBeNull();
    await deleteCredentials(dir);
  });

  it('caches the DCR client_id per issuer, also 0600', async () => {
    const dir = await tempDir();
    await writeCachedClientId(dir, 'https://rightis.org', 'c1');
    await writeCachedClientId(dir, 'http://localhost:3000', 'c2');
    expect(await readCachedClientId(dir, 'https://rightis.org')).toBe('c1');
    expect(await readCachedClientId(dir, 'http://localhost:3000')).toBe('c2');
    await writeCachedClientId(dir, 'https://rightis.org', null);
    expect(await readCachedClientId(dir, 'https://rightis.org')).toBeNull();
    expect(await mode(join(dir, 'clients.json'))).toBe(0o600);
    expect(await readFile(join(dir, 'clients.json'), 'utf8')).not.toContain('rat_');
  });
});
