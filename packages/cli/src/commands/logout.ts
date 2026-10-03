import { str } from '../args.js';
import { configDir, resolveBaseUrl } from '../config.js';
import { deleteCredentials, readCredentials } from '../credentials.js';
import { revokeToken } from '../oauth.js';
import type { Command } from './types.js';

export const logoutCommand: Command = {
  name: 'logout',
  summary: 'Revoke the stored token and delete it',
  help: `Usage: rightis logout

Revokes the stored refresh and access tokens on the server, then deletes
~/.config/rightis/credentials.json. The file is deleted even if the server
cannot be reached.`,
  options: {},
  async run(io, args) {
    // Validates --base-url if given; logout acts on whatever is stored.
    if (args.values['base-url'] !== undefined) resolveBaseUrl(str(args.values['base-url']), io.env);
    const dir = configDir(io.env);
    const creds = await readCredentials(dir);
    if (!creds) {
      io.out('Not logged in.');
      return 0;
    }
    if (creds.revocation_endpoint) {
      for (const [token, hint] of [
        [creds.refresh_token, 'refresh_token'],
        [creds.access_token, 'access_token'],
      ] as const) {
        try {
          await revokeToken(io.fetch, creds.revocation_endpoint, { token, hint, clientId: creds.client_id });
        } catch (e) {
          io.err(`Warning: could not revoke the ${hint.replace('_', ' ')} on the server (${(e as Error).message}).`);
        }
      }
    }
    await deleteCredentials(dir);
    io.out(`Logged out of ${creds.base_url}.`);
    return 0;
  },
};
