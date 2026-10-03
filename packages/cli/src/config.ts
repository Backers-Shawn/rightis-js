import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_BASE_URL } from '@rightis/sdk';

import { UsageError } from './errors.js';

/** `RIGHTIS_CONFIG_DIR`, else `$XDG_CONFIG_HOME/rightis`, else `~/.config/rightis`. */
export function configDir(env: Record<string, string | undefined>): string {
  if (env.RIGHTIS_CONFIG_DIR) return env.RIGHTIS_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'rightis');
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
}

/**
 * `--base-url`, else `RIGHTIS_API_URL`, else https://rightis.org.
 * http is accepted only for a server on this machine: tokens and keys travel on these requests.
 */
export function resolveBaseUrl(flag: string | undefined, env: Record<string, string | undefined>): string {
  const raw = (flag || env.RIGHTIS_API_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`Not a URL: ${raw}`);
  }
  if (url.protocol === 'https:') return raw;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return raw;
  throw new UsageError(`Base URL must use https (http is allowed only for localhost): ${raw}`);
}
