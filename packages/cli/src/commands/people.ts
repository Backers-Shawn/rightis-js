import { Rightis, keyEnvironment } from '@rightis/sdk';

import { str } from '../args.js';
import { resolveBaseUrl } from '../config.js';
import { loadSecretKey } from '../envfile.js';
import { CliError } from '../errors.js';
import { table } from '../format.js';
import type { Command } from './types.js';

export const peopleCommand: Command = {
  name: 'people',
  summary: 'List the sandbox sample people',
  help: `Usage: rightis people [--json] [--base-url <url>]

Lists the fixed sandbox people your sandbox key can check against. They are
not real people and never appear in the public registry. Needs a sandbox key
(brk_test_...) in RIGHTIS_SECRET_KEY or .env.local.`,
  options: {
    json: { type: 'boolean' },
  },
  async run(io, args) {
    const baseUrl = resolveBaseUrl(str(args.values['base-url']), io.env);
    const found = await loadSecretKey(io.cwd, io.env);
    if (!found) throw new CliError('No API key. Run npx rightis init, or set RIGHTIS_SECRET_KEY to a sandbox key.');
    if (keyEnvironment(found.key) !== 'sandbox') {
      throw new CliError(`The key in ${found.source} is not a sandbox key (brk_test_...). Sample people exist only in the sandbox.`);
    }
    const rightis = new Rightis({ apiKey: found.key, baseUrl, fetch: io.fetch });
    const { people } = await rightis.sandbox.people();
    if (args.values.json) {
      io.out(JSON.stringify({ people }, null, 2));
      return 0;
    }
    if (people.length === 0) {
      io.out('No sandbox people on this server yet.');
      return 0;
    }
    io.out(table([['RIGHTS ID', 'NAME', 'PRESET', 'SUMMARY'], ...people.map((p) => [p.rights_id, p.display_name, p.preset, p.summary])]).join('\n'));
    io.out('');
    io.out(`Next: npx rightis check ${people[0]!.rights_id} --use "social media ad" --asset face`);
    return 0;
  },
};
