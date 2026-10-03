import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { writePrivateFile } from './files.js';

/** What `rightis login` stores. The file is 0600 in a 0700 directory. */
export interface Credentials {
  access_token: string;
  refresh_token: string;
  /** ISO 8601. */
  expires_at: string;
  client_id: string;
  base_url: string;
  scope?: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}

export function credentialsPath(dir: string): string {
  return join(dir, 'credentials.json');
}

export function clientsPath(dir: string): string {
  return join(dir, 'clients.json');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

export async function readCredentials(dir: string): Promise<Credentials | null> {
  const c = await readJson<Credentials>(credentialsPath(dir));
  if (!c || typeof c.access_token !== 'string' || typeof c.refresh_token !== 'string') return null;
  return c;
}

export async function writeCredentials(dir: string, creds: Credentials): Promise<void> {
  await writePrivateFile(credentialsPath(dir), `${JSON.stringify(creds, null, 2)}\n`);
}

export async function deleteCredentials(dir: string): Promise<void> {
  await rm(credentialsPath(dir), { force: true });
}

/** Dynamic Client Registration result, cached per authorization server issuer. Not a secret (public client). */
export async function readCachedClientId(dir: string, issuer: string): Promise<string | null> {
  const all = await readJson<Record<string, { client_id: string }>>(clientsPath(dir));
  return all?.[issuer]?.client_id ?? null;
}

export async function writeCachedClientId(dir: string, issuer: string, clientId: string | null): Promise<void> {
  const all = (await readJson<Record<string, { client_id: string }>>(clientsPath(dir))) ?? {};
  if (clientId) all[issuer] = { client_id: clientId };
  else delete all[issuer];
  await writePrivateFile(clientsPath(dir), `${JSON.stringify(all, null, 2)}\n`);
}
