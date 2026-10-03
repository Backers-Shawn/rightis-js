import { str } from '../args.js';
import { resolveBaseUrl } from '../config.js';
import { login } from '../oauth.js';
import type { Command } from './types.js';

export const loginCommand: Command = {
  name: 'login',
  summary: 'Sign in with your browser (OAuth, PKCE)',
  help: `Usage: rightis login [--base-url <url>] [--no-browser] [--reregister]

Opens your browser to sign in to Rightis and stores a token in
~/.config/rightis/credentials.json (mode 0600). The token is never printed.

Options:
  --no-browser     Print the sign-in URL instead of opening a browser
  --reregister     Register the CLI with the server again (if the browser says the client is unknown)
  --base-url <url> Rightis server (default: RIGHTIS_API_URL or https://rightis.org)`,
  options: {
    'no-browser': { type: 'boolean' },
    reregister: { type: 'boolean' },
  },
  async run(io, args) {
    const baseUrl = resolveBaseUrl(str(args.values['base-url']), io.env);
    await login(io, baseUrl, { reregister: args.values.reregister === true, browser: args.values['no-browser'] !== true });
    io.out(`Logged in to ${baseUrl}.`);
    io.out('Next: npx rightis init');
    return 0;
  },
};
