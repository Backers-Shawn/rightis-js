import { execFile } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ENV_FILE = '.env.local';
export const KEY_VAR = 'RIGHTIS_SECRET_KEY';

export type GitIgnoreStatus = 'ignored' | 'not_ignored' | 'tracked' | 'not_a_repo' | 'git_missing';

function git(cwd: string, args: string[]): Promise<{ code: number | null; missing: boolean }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (error) => {
      if (!error) return resolve({ code: 0, missing: false });
      const e = error as NodeJS.ErrnoException & { code?: string | number };
      if (e.code === 'ENOENT') return resolve({ code: null, missing: true });
      resolve({ code: typeof e.code === 'number' ? e.code : 1, missing: false });
    });
  });
}

/** Asks git, not our own reading of .gitignore: global excludes and nested rules count too. */
export async function gitIgnoreStatus(cwd: string, file = ENV_FILE): Promise<GitIgnoreStatus> {
  const ignored = await git(cwd, ['check-ignore', '-q', '--', file]);
  if (ignored.missing) return 'git_missing';
  if (ignored.code === 0) return 'ignored';
  if (ignored.code === 128) return 'not_a_repo';
  // check-ignore says "not ignored" for a tracked file even when a rule matches it.
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', file]);
  return tracked.code === 0 ? 'tracked' : 'not_ignored';
}

const KEY_LINE = new RegExp(`^\\s*(?:export\\s+)?${KEY_VAR}\\s*=`, 'm');

/** Reads one variable from dotenv text. Enough for KEY=value, quotes and comments. */
export function readEnvValue(content: string, name: string): string | undefined {
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`, 'm');
  const m = content.match(re);
  if (!m) return undefined;
  let v = m[1]!.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  else v = v.replace(/\s+#.*$/, '');
  return v || undefined;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export type EnvPreflight = { ok: true; path: string } | { ok: false; message: string };

/**
 * Decides whether `rightis init` may write the key, before any key is created.
 * Refuses unless git ignores the file, and refuses to replace an existing key without `force`.
 */
export async function preflightEnvLocal(cwd: string, opts: { force?: boolean } = {}): Promise<EnvPreflight> {
  const path = join(cwd, ENV_FILE);
  const status = await gitIgnoreStatus(cwd);
  const addLine = `Add this line to .gitignore and run again:\n\n  ${ENV_FILE}\n`;
  switch (status) {
    case 'git_missing':
      return { ok: false, message: `Refusing to write ${ENV_FILE}: git is not installed, so I cannot confirm the file is ignored.` };
    case 'not_a_repo':
      return {
        ok: false,
        message: `Refusing to write ${ENV_FILE}: this directory is not in a git repository, so I cannot confirm the file is ignored.\nRun git init, then ${addLine}`,
      };
    case 'tracked':
      return {
        ok: false,
        message: `Refusing to write ${ENV_FILE}: git already tracks it. Remove it from the index (git rm --cached ${ENV_FILE}), then ${addLine}`,
      };
    case 'not_ignored':
      return { ok: false, message: `Refusing to write ${ENV_FILE}: git does not ignore it. ${addLine}` };
    case 'ignored':
      break;
  }
  const existing = await readIfExists(path);
  if (existing !== null && KEY_LINE.test(existing) && !opts.force) {
    return {
      ok: false,
      message: `${KEY_VAR} is already set in ${ENV_FILE}. Not overwriting it. Run again with --force to replace it (the old key stays valid until you revoke it).`,
    };
  }
  return { ok: true, path };
}

/**
 * Writes `RIGHTIS_SECRET_KEY=<secret>` into .env.local, keeping every other
 * line. Call `preflightEnvLocal` first. Prints nothing: the caller says only
 * that the key was written.
 */
export async function writeSecretKey(cwd: string, secret: string, opts: { force?: boolean } = {}): Promise<void> {
  const check = await preflightEnvLocal(cwd, opts);
  if (!check.ok) throw new Error(check.message);
  const line = `${KEY_VAR}=${secret}`;
  const existing = await readIfExists(check.path);
  if (existing === null) {
    await writeFile(check.path, `${line}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(check.path, 0o600);
    return;
  }
  let next: string;
  if (KEY_LINE.test(existing)) {
    const re = new RegExp(`^\\s*(?:export\\s+)?${KEY_VAR}\\s*=.*$`, 'gm');
    // A function replacement: a secret containing $ must not be read as a pattern.
    next = existing.replace(re, () => line);
  } else {
    next = `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${line}\n`;
  }
  await writeFile(check.path, next);
}

/** The key for `people` and `check`: the environment first, then .env.local in the current directory. */
export async function loadSecretKey(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ key: string; source: 'environment' | typeof ENV_FILE } | null> {
  const fromEnv = env[KEY_VAR]?.trim();
  if (fromEnv) return { key: fromEnv, source: 'environment' };
  const content = await readIfExists(join(cwd, ENV_FILE));
  const fromFile = content ? readEnvValue(content, KEY_VAR) : undefined;
  return fromFile ? { key: fromFile, source: ENV_FILE } : null;
}
