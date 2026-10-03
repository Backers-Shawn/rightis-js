import { RightisConsole, RightisError } from '@rightis/sdk';

import { str } from '../args.js';
import { configDir, resolveBaseUrl } from '../config.js';
import { readCredentials } from '../credentials.js';
import { CliError } from '../errors.js';
import { table } from '../format.js';
import { getAccessToken } from '../oauth.js';
import type { Command } from './types.js';

export function consoleUnavailable(baseUrl: string): CliError {
  return new CliError(
    `${baseUrl} does not have the console API yet (GET /api/v1/console returned 404). This command needs the Rightis server release that adds it.`,
  );
}

export const whoamiCommand: Command = {
  name: 'whoami',
  summary: 'Show the signed-in organization, apps and keys',
  help: `Usage: rightis whoami [--base-url <url>]

Shows the organization, apps and API keys of the signed-in developer.
Key secrets are never shown; only their public ids.`,
  options: {},
  async run(io, args) {
    const baseUrl = resolveBaseUrl(str(args.values['base-url']), io.env);
    const token = await getAccessToken(io, baseUrl);
    const creds = await readCredentials(configDir(io.env));
    const client = new RightisConsole({ accessToken: token, baseUrl, fetch: io.fetch });
    let overview;
    try {
      overview = await client.get();
    } catch (e) {
      if (e instanceof RightisError && e.status === 404) throw consoleUnavailable(baseUrl);
      throw e;
    }
    const org = overview.organization;
    const rows: string[][] = [
      ['server', baseUrl],
      ['organization', org ? `${org.name} (${org.status})` : 'none yet (run: npx rightis init)'],
      ['production', overview.production_unlocked ? 'unlocked' : 'locked'],
    ];
    if (creds?.expires_at) rows.push(['token expires', creds.expires_at]);
    for (const app of overview.apps) rows.push([`app ${app.environment}`, `${app.name} (${app.status})`]);
    io.out(table(rows).join('\n'));
    if (overview.keys.length > 0) {
      io.out('');
      io.out(
        table([
          ['KEY ID', 'ENVIRONMENT', 'STATUS', 'LABEL', 'LAST USED'],
          ...overview.keys.map((k) => [k.key_id_public, k.environment, k.status, k.label ?? '', k.last_used_at ?? 'never']),
        ]).join('\n'),
      );
    }
    return 0;
  },
};
