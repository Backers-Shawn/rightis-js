# rightis

**Use this before your code generates a real person's face, voice or persona.** The Rightis CLI checks the public registry of identity rights from your terminal, and sets up a sandbox key for the [`@rightis/sdk`](https://www.npmjs.com/package/@rightis/sdk).

Node 20 or later.

## 30-second quickstart

```bash
npx rightis check BR-XXXX-XXXX-XXXX --use "instagram ad" --asset face --public
```

`--public` asks the keyless resolve, so no account is needed. It prints the `decision`, the `next_action` and the per-scope states:

| `decision` | `next_action.type` | Meaning |
|---|---|---|
| `allowed` | `request_license` | Pre-approved scopes. **Not free use**: still request the licence. |
| `requires_approval` | `request_license` | The holder decides each request. |
| `unspecified` | `request_license` | The holder has said nothing. Not a yes. |
| `denied` | `stop` | Refused. Do not generate. |
| `null` | `not_registered` | Not in the registry. **Not cleared.** |
| `null` | `describe_use` | No use described. Add `use_type`, `ai_methods`, `asset_types`. |

A failed lookup is not "not registered": on any error, do not generate.

## Sandbox and keys

```bash
npx rightis login                       # 1. sign in in your browser
npx rightis init                        # 2. sandbox key into .env.local, plus rightis-example.mjs
npx rightis people                      # 3. list the sandbox sample people
npx rightis check BR-SANDBOX-... --use "social media ad" --asset face   # 4. first check
node --env-file=.env.local rightis-example.mjs                          # 5. the same check from code
```

## Links

- Developers: https://rightis.org/en/developers
- Guide, generating real people: https://rightis.org/en/developers/guides/real-person-likeness
- For AI coding assistants: [Claude Code skill](https://github.com/Backers-Shawn/rightis-js/blob/main/skills/rightis/SKILL.md), [Cursor rule](https://github.com/Backers-Shawn/rightis-js/blob/main/.cursor/rules/rightis.mdc), [AGENTS.md](https://github.com/Backers-Shawn/rightis-js/blob/main/AGENTS.md) (Codex and others, with a snippet for your own AGENTS.md or CLAUDE.md)
- Source: https://github.com/Backers-Shawn/rightis-js

## Commands

| Command | What it does |
|---|---|
| `rightis login` | Browser sign-in with OAuth 2.1 and PKCE on a loopback port. Stores the token in `~/.config/rightis/credentials.json` (0600, directory 0700) and refreshes it automatically. `--no-browser` prints the URL instead. |
| `rightis logout` | Revokes the tokens on the server and deletes the file. |
| `rightis whoami` | Your organization, apps and keys (public key ids only). |
| `rightis init` | Creates your organization if needed, issues a sandbox key, writes `RIGHTIS_SECRET_KEY` to `.env.local`, and writes an example. `--yes`, `--force`, `--framework next`, `--org-name`, `--use-case`, `--website`. |
| `rightis people` | The sandbox sample people. Needs a `brk_test_` key in the environment or `.env.local`. |
| `rightis check <rights_id>` | Decision, next action and scopes. `--use`, `--asset face\|voice\|style\|image` (repeatable), `--method image_generation\|video_generation\|voice_synthesis` (repeatable), `--training`, `--json`, `--public`. |

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
