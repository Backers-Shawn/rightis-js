import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseCommandArgs } from '../src/args.js';
import { UsageError } from '../src/errors.js';
import { main } from '../src/main.js';
import { CLI_VERSION } from '../src/version.js';
import { fakeIo } from './helpers.js';

const CHECK_SPEC = {
  use: { type: 'string' as const },
  asset: { type: 'string' as const, multiple: true },
  training: { type: 'boolean' as const },
  json: { type: 'boolean' as const },
};

describe('parseCommandArgs', () => {
  it('reads positionals, strings, repeated flags and booleans in any order', () => {
    const a = parseCommandArgs(['BR-1', '--asset', 'face', '--use=instagram ad', '--asset', 'voice', '--training'], CHECK_SPEC);
    expect(a.positionals).toEqual(['BR-1']);
    expect(a.values.use).toBe('instagram ad');
    expect(a.values.asset).toEqual(['face', 'voice']);
    expect(a.values.training).toBe(true);
    expect(a.values.json).toBeUndefined();
  });

  it('accepts the global --base-url and -h on every command', () => {
    const a = parseCommandArgs(['-h', '--base-url', 'http://localhost:3000'], {});
    expect(a.values.help).toBe(true);
    expect(a.values['base-url']).toBe('http://localhost:3000');
  });

  it('rejects unknown flags and missing values as usage errors', () => {
    expect(() => parseCommandArgs(['--nope'], CHECK_SPEC)).toThrow(UsageError);
    expect(() => parseCommandArgs(['--use'], CHECK_SPEC)).toThrow(UsageError);
  });
});

describe('main dispatch', () => {
  it('prints help with no arguments and exits 0', async () => {
    const io = fakeIo();
    expect(await main([], io)).toBe(0);
    expect(io.stdout.join('\n')).toContain('Usage: rightis <command>');
    for (const c of ['login', 'logout', 'whoami', 'init', 'people', 'check']) expect(io.stdout.join('\n')).toContain(c);
  });

  it('prints the version, matching package.json', async () => {
    const io = fakeIo();
    expect(await main(['--version'], io)).toBe(0);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(io.stdout).toEqual([pkg.version]);
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('prints per-command help', async () => {
    const io = fakeIo();
    expect(await main(['check', '--help'], io)).toBe(0);
    expect(io.stdout.join('\n')).toContain('Usage: rightis check <rights_id>');
    const io2 = fakeIo();
    expect(await main(['help', 'init'], io2)).toBe(0);
    expect(io2.stdout.join('\n')).toContain('Usage: rightis init');
  });

  it('exits 2 on usage errors', async () => {
    expect(await main(['frobnicate'], fakeIo())).toBe(2);
    expect(await main(['check'], fakeIo())).toBe(2);
    expect(await main(['check', 'BR-1', '--asset', 'tattoo'], fakeIo())).toBe(2);
    expect(await main(['check', 'BR-1', '--bogus'], fakeIo())).toBe(2);
    expect(await main(['check', 'BR-1', '--base-url', 'http://example.com'], fakeIo())).toBe(2);
  });

  it('has no arrows or emoji in help output', async () => {
    const io = fakeIo();
    await main(['--help'], io);
    for (const c of [...io.stdout.join('\n')]) expect(c.codePointAt(0)!).toBeLessThan(128);
    expect(io.stdout.join('\n')).not.toMatch(/->|=>/);
  });
});
