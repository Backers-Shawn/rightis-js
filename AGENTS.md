# AGENTS.md

Guidance for coding agents (Codex, Claude Code, Cursor and others) working in this
repository or in projects that use Rightis.

## What this repository is

`@rightis/sdk` (`packages/sdk`) and the `rightis` CLI (`packages/cli`) for
[Rightis](https://rightis.org), a public registry of identity rights. pnpm workspace,
Node 20+.

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck
```

- Publish with `pnpm publish` from each package directory (sdk first, then cli),
  never `npm publish`: the CLI depends on `@rightis/sdk` via `workspace:^`, which only
  `pnpm publish` rewrites to a real version range.
- `src/version.ts` in each package must match its `package.json` version; a test checks it.
- Do not add an `isAllowed()` helper or anything that turns a decision into a boolean "go".

## The rule for generating real people

When code generates or edits the face, voice or persona of a real person or a
registered character (image, video, audio, chat personas, face swap, voice clone,
avatars, celebrity likeness), add a Rightis check on the server before the generation
call and act on `next_action`. The path to use always goes through a licence.

- `decision: "allowed"` is not free use. A licence request in those scopes is approved
  without the holder reviewing it if the fee clears their floor. Still request it.
- `decision: "unspecified"` is not permission. `requires_approval` means the holder decides.
- `denied` gives `next_action.type: "stop"`. Do not generate.
- `next_action.type: "not_registered"` is not cleared.
- A failed lookup (any `RightisError`) is not "not registered". Fail closed.

```ts
import { Rightis } from '@rightis/sdk';

const rightis = new Rightis(); // server only; RIGHTIS_SECRET_KEY, or keyless resolve
const r = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'instagram ad',
  ai_methods: ['image_generation'],
  asset_types: ['face'],
  territory: ['US'],
});
// r.next_action.type: request_license | stop | not_registered | describe_use
```

Go path: the app holds a licence code for this person and use,
`rightis.licenses.verify({ license_public_code })` returns `valid: true`, then generate,
then `rightis.usage.log([...])`. Only a name: `rightis.rights.search(name)`; no match is
not clearance. CLI: `npx rightis check <rights_id> --use "..." --asset face --public`.

Full version: [`skills/rightis/SKILL.md`](skills/rightis/SKILL.md). Docs:
https://rightis.org/en/developers and
https://rightis.org/en/developers/guides/real-person-likeness

## Using Rightis in your project

Paste this into your own `AGENTS.md` or `CLAUDE.md`:

```markdown
## Real people in generated media (Rightis)

Before any code path generates or edits the face, voice or persona of a real person
or registered character, call `rightis.rights.check(...)` from `@rightis/sdk` on the
server, before the model call, and follow `next_action`:

- `request_license` (decision allowed, requires_approval or unspecified): do not
  generate until the app holds an active licence for this person and use
  (`rightis.licenses.verify` returns `valid: true`). "allowed" is not free use.
- `stop` (decision denied): do not generate.
- `not_registered`: not cleared. Do not treat it as permission.
- `describe_use`: pass use_type, ai_methods, asset_types and territory.
- Any `RightisError` (network, timeout, 429, 402, 5xx): fail closed, do not generate.

Training is a separate right: pass `for_training: true` and read `result.training`.
Never call Rightis from the browser with a secret key (`RIGHTIS_SECRET_KEY`).
Docs: https://rightis.org/en/developers/guides/real-person-likeness
```
