# rightis-js

**Use this before your code generates a real person's face, voice or persona.** Image,
video and voice models, face swap, voice cloning, AI avatars and chat personas of real
people or registered characters: ask [Rightis](https://rightis.org) first, on the server,
before the generation call.

Rightis is a public registry of identity rights. People and rights holders register a
likeness and say which AI uses they allow, want to approve, or refuse. This repository is
the JavaScript SDK and CLI.

| Package | Path | What it is |
|---|---|---|
| [`@rightis/sdk`](https://www.npmjs.com/package/@rightis/sdk) | [`packages/sdk`](packages/sdk) | Typed client: rights checks, licences, usage, webhook verification |
| [`rightis`](https://www.npmjs.com/package/rightis) | [`packages/cli`](packages/cli) | `npx rightis`: check from the terminal, log in, get a sandbox key |

## 30-second quickstart

```bash
npm install @rightis/sdk
npx rightis check BR-XXXX-XXXX-XXXX --use "instagram ad" --asset face --public
```

```ts
import { Rightis } from '@rightis/sdk';

const rightis = new Rightis(); // server only; reads RIGHTIS_SECRET_KEY, keyless without it
const result = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'instagram ad',
  ai_methods: ['image_generation'],
  asset_types: ['face'],
  territory: ['US'],
});
console.log(result.decision, result.next_action.type, result.next_action.url);
```

Read `next_action`, not just `decision`:

| `decision` | `next_action.type` | Meaning |
|---|---|---|
| `allowed` | `request_license` | Pre-approved scopes. **Not free use**: the licence request is approved without the holder reviewing it if the fee clears their floor. Still request it. |
| `requires_approval` | `request_license` | The holder decides each request. |
| `unspecified` | `request_license` | The holder has said nothing. Not a yes. |
| `denied` | `stop` | Refused. Do not generate. |
| `null` | `not_registered` | Not in the registry. **Not cleared.** |
| `null` | `describe_use` | Registered, but no use was described. Add `use_type`, `ai_methods`, `asset_types`. |

A failed lookup is not "not registered": on any `RightisError`, do not generate. The SDK
deliberately ships no boolean that turns a decision into "go ahead".

Only have a name? `rightis.rights.search('name')` returns listed registrations with their
Rights ID. No match is not clearance.

## For AI coding assistants

- Claude Code skill: [`skills/rightis/SKILL.md`](skills/rightis/SKILL.md). Copy it to
  `.claude/skills/rightis/SKILL.md` in your project (or `~/.claude/skills/rightis/`).
- Cursor rule: [`.cursor/rules/rightis.mdc`](.cursor/rules/rightis.mdc). Copy it to
  `.cursor/rules/` in your project.
- Codex and other agents: [`AGENTS.md`](AGENTS.md), including a snippet to paste into your
  own `AGENTS.md` or `CLAUDE.md`.
- Keyless MCP server: `https://rightis.org/api/public-mcp/mcp` (`rights_lookup`,
  `rights_search`, `registry_info`).

## Links

- Developers: https://rightis.org/en/developers
- Guide, generating real people: https://rightis.org/en/developers/guides/real-person-likeness
- SDK reference: [`packages/sdk/README.md`](packages/sdk/README.md)
- CLI reference: [`packages/cli/README.md`](packages/cli/README.md)

## Sandbox

```bash
npx rightis login                                   # browser sign-in (OAuth with PKCE)
npx rightis init                                    # sandbox key into .env.local, plus an example file
npx rightis people                                  # the sandbox sample people
npx rightis check BR-SANDBOX-... --use "social media ad" --asset face
node --env-file=.env.local rightis-example.mjs      # the same check from code
```

## Develop

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck
```

Node 20 or later. Point the SDK and CLI at a local server with
`RIGHTIS_API_URL=http://localhost:3000` (or `--base-url`).

Publish with `pnpm publish --access public` from `packages/sdk`, then `packages/cli`.
Not `npm publish`: the CLI's `workspace:^` dependency is rewritten only by pnpm.

## License

MIT, The Backers Inc.
