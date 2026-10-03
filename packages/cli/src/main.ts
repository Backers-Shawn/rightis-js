import { RightisError } from '@rightis/sdk';

import { parseCommandArgs } from './args.js';
import { checkCommand } from './commands/check.js';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { peopleCommand } from './commands/people.js';
import type { Command } from './commands/types.js';
import { whoamiCommand } from './commands/whoami.js';
import { CliError } from './errors.js';
import type { Io } from './io.js';
import { CLI_VERSION } from './version.js';

export const COMMANDS: Command[] = [loginCommand, logoutCommand, whoamiCommand, initCommand, peopleCommand, checkCommand];

export function mainHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return `Rightis CLI ${CLI_VERSION}

Usage: rightis <command> [options]

Commands:
${COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n')}

Global options:
  --base-url <url>  Rightis server (default: RIGHTIS_API_URL or https://rightis.org)
  -h, --help        Show help (rightis <command> --help for a command)
  -v, --version     Show the version

Start here:
  npx rightis login
  npx rightis init
  npx rightis people
  npx rightis check <rights_id> --use "social media ad" --asset face`;
}

/** Runs one invocation and returns the exit code. Never calls process.exit. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help') {
    io.out(mainHelp());
    return 0;
  }
  if (first === '-v' || first === '--version') {
    io.out(CLI_VERSION);
    return 0;
  }
  if (first === 'help') {
    const cmd = COMMANDS.find((c) => c.name === rest[0]);
    io.out(cmd ? cmd.help : mainHelp());
    return 0;
  }
  const cmd = COMMANDS.find((c) => c.name === first);
  if (!cmd) {
    io.err(`Unknown command: ${first}`);
    io.err('Run rightis --help to see the commands.');
    return 2;
  }
  try {
    const args = parseCommandArgs(rest, cmd.options);
    if (args.values.help) {
      io.out(cmd.help);
      return 0;
    }
    return await cmd.run(io, args);
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`Error: ${e.message}`);
      if (e.exitCode === 2) io.err(`Run rightis ${cmd.name} --help for usage.`);
      return e.exitCode;
    }
    if (e instanceof RightisError) {
      io.err(`Error: ${e.message} (${e.code}${e.status ? `, HTTP ${e.status}` : ''}${e.requestId ? `, request ${e.requestId}` : ''})`);
      if (e.code === 'VALIDATION_ERROR' && e.details) io.err(`Details: ${JSON.stringify(e.details)}`);
      if (e.code === 'INSUFFICIENT_CREDIT') io.err('Your API credit is used up. Top up in the Rightis developer console.');
      if (e.status === 429 && e.retryAfterSeconds !== null) io.err(`Rate limited. Try again in ${e.retryAfterSeconds} seconds.`);
      return 1;
    }
    io.err(`Error: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }
}
