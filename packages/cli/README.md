# rightis

The Rightis CLI. Sign in, get a sandbox key, and run your first rights check in about five minutes.

> **Not on npm yet.** This package will be published as `rightis@0.1.0`. `rightis check` works against rightis.org today. `login`, `init` and `whoami` need the Rightis server release that adds the console API (`/api/v1/console`) and the `console:manage` OAuth scope; `people` needs that release's sandbox sample people.

Node 20 or later.

## Quickstart

```bash
npx rightis login                       # 1. sign in in your browser
npx rightis init                        # 2. sandbox key into .env.local, plus rightis-example.mjs
npx rightis people                      # 3. list the sandbox sample people
npx rightis check BR-SANDBOX-... --use "social media ad" --asset face   # 4. first check
node --env-file=.env.local rightis-example.mjs                          # 5. the same check from code
```

## Commands

| Command | What it does |
|---|---|
| `rightis login` | Browser sign-in with OAuth 2.1 and PKCE on a loopback port. Stores the token in `~/.config/rightis/credentials.json` (0600, directory 0700) and refreshes it automatically. `--no-browser` prints the URL instead. |
| `rightis logout` | Revokes the tokens on the server and deletes the file. |
| `rightis whoami` | Your organization, apps and keys (public key ids only). |
| `rightis init` | Creates your organization if needed, issues a sandbox key, writes `RIGHTIS_SECRET_KEY` to `.env.local`, and writes an example. `--yes`, `--force`, `--framework next`, `--org-name`, `--use-case`, `--website`. |
| `rightis people` | The sandbox sample people. Needs a `brk_test_` key in the environment or `.env.local`. |
| `rightis check <rights_id>` | Decision, next action and scopes. `--use`, `--asset face\|voice\|style\|image` (repeatable), `--training`, `--json`, `--public`. |

Every command takes `--base-url <url>` (or `RIGHTIS_API_URL`) for a local server; http is accepted only for localhost.

## How `init` treats your key

- It checks with `git check-ignore` that `.env.local` is ignored **before** it creates a key. Outside a git repository, or if the file is not ignored or is already tracked, it refuses and tells you what to add to `.gitignore`.
- It never replaces an existing `RIGHTIS_SECRET_KEY` without `--force`.
- It never prints the key. It says only `Wrote RIGHTIS_SECRET_KEY to .env.local`.

## Reading `check`

`check` exits 0 for every decision, because a decision is information. It exits 1 on errors and 2 on bad arguments.

`allowed` is not free use: a licence request in those scopes is approved without the holder reviewing it, but you still request it (`next_action: request_license`). `not_registered` is not permission. A sandbox key only knows the sandbox people; use `--public` to check a real Rights ID with the keyless resolve.

## License

MIT
