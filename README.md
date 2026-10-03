# rightis-js

JavaScript SDK and CLI for [Rightis](https://rightis.org), an identity-rights registry. People register their likeness; services ask Rightis before they generate with it.

| Package | Path | What it is |
|---|---|---|
| `@rightis/sdk` | [`packages/sdk`](packages/sdk) | Typed client: rights checks, licences, usage, webhook verification |
| `rightis` | [`packages/cli`](packages/cli) | `npx rightis`: log in, get a sandbox key, run your first check |

## Status

- **Not published to npm yet.** Both packages will be published at `0.1.0`. Until then, build them from this repository.
- **The console endpoints are not live yet.** `rightis login`, `rightis init` and `rightis whoami` need the Rightis server release that adds `/api/v1/console` and the `console:manage` OAuth scope. `rightis check` and the SDK's keyless calls work against rightis.org today.
- `rightis people` needs a sandbox key and the server's sandbox sample people, which ship with the same release.

## Quickstart

```bash
npx rightis login                                   # browser sign-in (OAuth with PKCE)
npx rightis init                                    # sandbox key into .env.local, plus an example file
npx rightis people                                  # the sandbox sample people
npx rightis check BR-SANDBOX-... --use "social media ad" --asset face
node --env-file=.env.local rightis-example.mjs      # the same check from code
```

```ts
import { Rightis } from '@rightis/sdk';

const rightis = new Rightis(); // reads RIGHTIS_SECRET_KEY
const result = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'social media ad',
  asset_types: ['face'],
});
console.log(result.decision, result.next_action);
```

## One rule to read first

`decision: "allowed"` is **not free use**. It means a licence request in those scopes is approved without the holder reviewing it, provided the fee clears their floor. `next_action.type` is still `request_license`. Not registered is not permission either. Follow `next_action`; the SDK deliberately ships no boolean that turns a decision into "go ahead".

## Develop

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck
```

Node 20 or later. Point the SDK and CLI at a local server with `RIGHTIS_API_URL=http://localhost:3000` (or `--base-url`).

## License

MIT
