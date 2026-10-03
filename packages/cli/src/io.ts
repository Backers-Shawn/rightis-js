import { createInterface } from 'node:readline/promises';

import type { FetchLike } from '@rightis/sdk';

import { openBrowser } from './browser.js';

/** Everything a command touches outside its own arguments. Tests pass a fake. */
export interface Io {
  out(line?: string): void;
  err(line?: string): void;
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  /** Whether a person can answer prompts. */
  interactive: boolean;
  prompt(question: string, fallback: string): Promise<string>;
  openBrowser(url: string): Promise<boolean>;
  now(): number;
}

export function processIo(): Io {
  return {
    out: (line = '') => process.stdout.write(`${line}\n`),
    err: (line = '') => process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    env: process.env,
    fetch: (input, init) => globalThis.fetch(input, init),
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    async prompt(question, fallback) {
      // Prompts go to stderr so stdout stays clean for piping.
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await rl.question(fallback ? `${question} (${fallback}): ` : `${question}: `)).trim();
        return answer || fallback;
      } finally {
        rl.close();
      }
    },
    openBrowser,
    now: () => Date.now(),
  };
}
