import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import { Rightis, RightisConsole, RightisError, type ConsoleUseCase } from '@rightis/sdk';

import { str } from '../args.js';
import { configDir, resolveBaseUrl } from '../config.js';
import { readCredentials } from '../credentials.js';
import { ENV_FILE, KEY_VAR, preflightEnvLocal, writeSecretKey } from '../envfile.js';
import { CliError, UsageError } from '../errors.js';
import type { Io } from '../io.js';
import { getAccessToken, login } from '../oauth.js';
import { exampleNextRoute, exampleScript } from '../templates.js';
import type { Command } from './types.js';
import { consoleUnavailable } from './whoami.js';

export const USE_CASES: readonly ConsoleUseCase[] = ['generation_gate', 'persona_product', 'verification', 'research', 'other'];
const DEFAULT_USE_CASE: ConsoleUseCase = 'generation_gate';
const PLACEHOLDER_ID = 'BR-XXXX-XXXX-XXXX';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The package name (without scope) or the directory name. */
async function defaultOrgName(cwd: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '');
  } catch {
    // no package.json
  }
  return basename(cwd);
}

async function examplePath(cwd: string, framework: 'node' | 'next'): Promise<string> {
  if (framework === 'node') return join(cwd, 'rightis-example.mjs');
  const appDir = (await exists(join(cwd, 'src', 'app'))) ? join(cwd, 'src', 'app') : join(cwd, 'app');
  return join(appDir, 'api', 'rightis-check', 'route.ts');
}

async function chooseOrganization(io: Io, values: Record<string, unknown>): Promise<{ name: string; useCase: ConsoleUseCase; website?: string }> {
  const yes = values.yes === true;
  let name = str(values['org-name'] as string | undefined);
  let useCase = str(values['use-case'] as string | undefined);
  const website = str(values.website as string | undefined);
  const fallbackName = await defaultOrgName(io.cwd);

  if ((!name || !useCase) && !yes && !io.interactive) {
    throw new UsageError('No organization yet. Pass --org-name and --use-case, or --yes to accept the defaults.');
  }
  if (!name) name = yes ? fallbackName : await io.prompt('Organization name', fallbackName);
  if (!useCase) {
    if (yes) useCase = DEFAULT_USE_CASE;
    else {
      io.err(`Use cases: ${USE_CASES.join(', ')}`);
      useCase = await io.prompt('What will you use Rightis for', DEFAULT_USE_CASE);
    }
  }
  if (!(USE_CASES as readonly string[]).includes(useCase)) {
    throw new UsageError(`--use-case must be one of ${USE_CASES.join(', ')} (got ${useCase})`);
  }
  return { name: name.trim(), useCase: useCase as ConsoleUseCase, ...(website ? { website } : {}) };
}

export const initCommand: Command = {
  name: 'init',
  summary: 'Create a sandbox key in .env.local and an example file',
  help: `Usage: rightis init [--yes] [--force] [--framework node|next] [--org-name <name>] [--use-case <case>] [--website <url>]

The five-minute path:
  1. Signs you in if you are not signed in yet
  2. Creates your organization if you have none (asks for a name and use case)
  3. Issues a sandbox API key and writes RIGHTIS_SECRET_KEY to .env.local
  4. Writes an example that runs a rights check against a sandbox person

The key is written only if git ignores .env.local, an existing key is never
replaced without --force, and the key is never printed.

Options:
  --yes                Accept defaults instead of prompting
  --force              Replace an existing RIGHTIS_SECRET_KEY and example file
  --framework <name>   node (rightis-example.mjs, default) or next (app/api/rightis-check/route.ts)
  --org-name <name>    Organization name (default: package.json name or directory name)
  --use-case <case>    ${USE_CASES.join(', ')} (default: ${DEFAULT_USE_CASE})
  --website <url>      Your website (optional)`,
  options: {
    yes: { type: 'boolean', short: 'y' },
    force: { type: 'boolean' },
    framework: { type: 'string' },
    'org-name': { type: 'string' },
    'use-case': { type: 'string' },
    website: { type: 'string' },
  },
  async run(io, args) {
    const v = args.values;
    const force = v.force === true;
    const framework = (str(v.framework) ?? 'node') as 'node' | 'next';
    if (framework !== 'node' && framework !== 'next') throw new UsageError('--framework must be node or next');
    const baseUrl = resolveBaseUrl(str(v['base-url']), io.env);

    // Refuse before any key exists: a key created and then not written is a
    // live secret nobody holds.
    const pre = await preflightEnvLocal(io.cwd, { force });
    if (!pre.ok) throw new CliError(pre.message);

    const creds = await readCredentials(configDir(io.env));
    if (!creds || creds.base_url !== baseUrl) {
      io.err('Not logged in. Starting login.');
      await login(io, baseUrl);
      io.err(`Logged in to ${baseUrl}.`);
    }
    const token = await getAccessToken(io, baseUrl);
    const console_ = new RightisConsole({ accessToken: token, baseUrl, fetch: io.fetch });

    let overview;
    try {
      overview = await console_.get();
    } catch (e) {
      if (e instanceof RightisError && e.status === 404) throw consoleUnavailable(baseUrl);
      throw e;
    }

    if (!overview.organization) {
      const org = await chooseOrganization(io, v);
      const setup = await console_.setup({
        organization_name: org.name,
        use_case: org.useCase,
        ...(org.website ? { website_url: org.website } : {}),
      });
      io.out(setup.created ? `Created organization ${org.name}.` : 'Your organization was already set up.');
    } else {
      io.out(`Organization: ${overview.organization.name}`);
    }

    const issued = await console_.createKey({ environment: 'sandbox', label: 'rightis init' });
    try {
      await writeSecretKey(io.cwd, issued.secret, { force });
    } catch (e) {
      throw new CliError(
        `Created sandbox key ${issued.key.key_id_public} but could not write it to ${ENV_FILE}: ${(e as Error).message}\nRevoke that key in the Rightis console; it was not saved anywhere.`,
      );
    }
    io.out(`Wrote ${KEY_VAR} to ${ENV_FILE} (sandbox key ${issued.key.key_id_public}).`);

    let rightsId = PLACEHOLDER_ID;
    try {
      const { people } = await new Rightis({ apiKey: issued.secret, baseUrl, fetch: io.fetch }).sandbox.people();
      if (people[0]) rightsId = people[0].rights_id;
      else io.err('Warning: this server has no sandbox people yet. The example uses a placeholder Rights ID.');
    } catch (e) {
      io.err(`Warning: could not list sandbox people (${(e as Error).message}). The example uses a placeholder Rights ID.`);
    }

    const target = await examplePath(io.cwd, framework);
    const shown = relative(io.cwd, target);
    if ((await exists(target)) && !force) {
      io.out(`Skipped ${shown}: it already exists (use --force to overwrite).`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, framework === 'next' ? exampleNextRoute(rightsId) : exampleScript(rightsId));
      io.out(`Wrote ${shown}.`);
    }

    io.out('');
    io.out('Next:');
    io.out('  npx rightis people');
    io.out(`  npx rightis check ${rightsId} --use "social media ad" --asset face`);
    io.out('  npm install @rightis/sdk');
    io.out(framework === 'next' ? '  then call POST /api/rightis-check from your app' : `  node --env-file=${ENV_FILE} ${shown}`);
    return 0;
  },
};
