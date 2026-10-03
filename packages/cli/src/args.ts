import { parseArgs } from 'node:util';

import { UsageError } from './errors.js';

export type OptionSpec = Record<string, { type: 'boolean' | 'string'; multiple?: boolean; short?: string }>;

/** Options every command accepts. */
export const GLOBAL_OPTIONS: OptionSpec = {
  help: { type: 'boolean', short: 'h' },
  'base-url': { type: 'string' },
};

export interface ParsedArgs {
  positionals: string[];
  values: Record<string, string | boolean | string[] | undefined>;
}

/** Strict parse: unknown flags and missing values are usage errors (exit 2). */
export function parseCommandArgs(args: string[], spec: OptionSpec): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...spec },
      allowPositionals: true,
      strict: true,
    });
    return { positionals, values: values as ParsedArgs['values'] };
  } catch (e) {
    const msg = (e as Error).message.replace(/\. To specify a positional argument.*$/s, '.');
    throw new UsageError(msg);
  }
}

export function str(v: ParsedArgs['values'][string]): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function list(v: ParsedArgs['values'][string]): string[] {
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? [v] : [];
}
