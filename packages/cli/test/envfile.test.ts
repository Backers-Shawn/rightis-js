import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { gitIgnoreStatus, loadSecretKey, preflightEnvLocal, readEnvValue, writeSecretKey } from '../src/envfile.js';
import { SECRET, tempDir, tempRepo } from './helpers.js';

describe('.env.local gitignore check', () => {
  it('refuses outside a git repository', async () => {
    const dir = await tempDir();
    expect(await gitIgnoreStatus(dir)).toBe('not_a_repo');
    const pre = await preflightEnvLocal(dir);
    expect(pre.ok).toBe(false);
    if (!pre.ok) expect(pre.message).toContain('.env.local');
  });

  it('refuses when git does not ignore .env.local, and says what to add', async () => {
    const dir = await tempRepo('node_modules\n');
    expect(await gitIgnoreStatus(dir)).toBe('not_ignored');
    const pre = await preflightEnvLocal(dir);
    expect(pre.ok).toBe(false);
    if (!pre.ok) expect(pre.message).toMatch(/Add this line to \.gitignore[\s\S]*\.env\.local/);
  });

  it('refuses when .env.local is already tracked, even if a rule matches', async () => {
    const dir = await tempRepo('');
    await writeFile(join(dir, '.env.local'), 'A=1\n');
    execFileSync('git', ['add', '.env.local'], { cwd: dir });
    await writeFile(join(dir, '.gitignore'), '.env.local\n');
    expect(await gitIgnoreStatus(dir)).toBe('tracked');
    expect((await preflightEnvLocal(dir)).ok).toBe(false);
  });

  it('accepts when ignored, including by a wildcard rule', async () => {
    expect(await gitIgnoreStatus(await tempRepo('.env.local\n'))).toBe('ignored');
    expect(await gitIgnoreStatus(await tempRepo('.env*\n'))).toBe('ignored');
    expect((await preflightEnvLocal(await tempRepo('.env*.local\n'))).ok).toBe(true);
  });
});

describe('.env.local writing', () => {
  it('creates the file 0600 with the key', async () => {
    const dir = await tempRepo('.env.local\n');
    await writeSecretKey(dir, SECRET);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(`RIGHTIS_SECRET_KEY=${SECRET}\n`);
    expect((await stat(join(dir, '.env.local'))).mode & 0o777).toBe(0o600);
  });

  it('appends to an existing file and keeps every other line', async () => {
    const dir = await tempRepo('.env.local\n');
    await writeFile(join(dir, '.env.local'), 'DATABASE_URL=postgres://x\n# comment');
    await writeSecretKey(dir, SECRET);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(`DATABASE_URL=postgres://x\n# comment\nRIGHTIS_SECRET_KEY=${SECRET}\n`);
  });

  it('never overwrites an existing key without force', async () => {
    const dir = await tempRepo('.env.local\n');
    await writeFile(join(dir, '.env.local'), 'A=1\nexport RIGHTIS_SECRET_KEY=brk_test_old\nB=2\n');
    const pre = await preflightEnvLocal(dir);
    expect(pre.ok).toBe(false);
    if (!pre.ok) expect(pre.message).toContain('--force');
    await expect(writeSecretKey(dir, SECRET)).rejects.toThrow(/already set/);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('brk_test_old');
  });

  it('replaces the key in place with force, without mangling $ in the secret', async () => {
    const dir = await tempRepo('.env.local\n');
    await writeFile(join(dir, '.env.local'), 'A=1\nRIGHTIS_SECRET_KEY=brk_test_old\nB=2\n');
    await writeSecretKey(dir, SECRET, { force: true });
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(`A=1\nRIGHTIS_SECRET_KEY=${SECRET}\nB=2\n`);
  });

  it('writeSecretKey re-checks the gitignore rule itself', async () => {
    const dir = await tempRepo('');
    await expect(writeSecretKey(dir, SECRET)).rejects.toThrow(/does not ignore/);
  });
});

describe('reading the key back', () => {
  it('parses dotenv values', () => {
    expect(readEnvValue('RIGHTIS_SECRET_KEY=abc\n', 'RIGHTIS_SECRET_KEY')).toBe('abc');
    expect(readEnvValue('export RIGHTIS_SECRET_KEY="abc"\n', 'RIGHTIS_SECRET_KEY')).toBe('abc');
    expect(readEnvValue("RIGHTIS_SECRET_KEY='abc' \n", 'RIGHTIS_SECRET_KEY')).toBe('abc');
    expect(readEnvValue('RIGHTIS_SECRET_KEY=abc # note\n', 'RIGHTIS_SECRET_KEY')).toBe('abc');
    expect(readEnvValue('# RIGHTIS_SECRET_KEY=abc\n', 'RIGHTIS_SECRET_KEY')).toBeUndefined();
    expect(readEnvValue('OTHER=1\n', 'RIGHTIS_SECRET_KEY')).toBeUndefined();
  });

  it('prefers the environment over .env.local', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, '.env.local'), 'RIGHTIS_SECRET_KEY=from_file\n');
    expect(await loadSecretKey(dir, { RIGHTIS_SECRET_KEY: 'from_env' })).toEqual({ key: 'from_env', source: 'environment' });
    expect(await loadSecretKey(dir, {})).toEqual({ key: 'from_file', source: '.env.local' });
    expect(await loadSecretKey(await tempDir(), {})).toBeNull();
  });
});
