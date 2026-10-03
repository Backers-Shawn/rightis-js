import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Creates the directory (and parents) and makes sure it is 0700. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/**
 * Writes a file only its owner can read (0600). Writes a temp file with that
 * mode first and renames it into place, so the contents are never readable
 * by others even for a moment and a crash cannot leave half a file.
 */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, content, { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
