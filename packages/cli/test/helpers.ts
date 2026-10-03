import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchLike } from '@rightis/sdk';

import type { Io } from '../src/io.js';

export interface FakeIo extends Io {
  stdout: string[];
  stderr: string[];
  all(): string;
}

export function fakeIo(over: Partial<Io> = {}): FakeIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    all: () => [...stdout, ...stderr].join('\n'),
    out: (l = '') => void stdout.push(l),
    err: (l = '') => void stderr.push(l),
    cwd: process.cwd(),
    env: {},
    fetch: async () => {
      throw new Error('no network in tests');
    },
    interactive: false,
    prompt: async (_q, fallback) => fallback,
    openBrowser: async () => false,
    now: () => Date.parse('2026-10-03T00:00:00Z'),
    ...over,
  };
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Routes by "METHOD path" to a handler. Records every call. Unknown routes fail the test. */
export function routedFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined };
    calls.push(call);
    const key = `${call.method} ${new URL(call.url).pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    return handler(call);
  };
  return { fetch, calls };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function tempDir(prefix = 'rightis-cli-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** A temp git repo, optionally with a .gitignore. */
export async function tempRepo(gitignore?: string): Promise<string> {
  const dir = await tempDir('rightis-repo-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (gitignore !== undefined) await writeFile(join(dir, '.gitignore'), gitignore);
  return dir;
}

export const SECRET = 'brk_test_0123456789ABCDEFGHIJKL.Zz9$1secretPART$&abcdefghijklmnop';
