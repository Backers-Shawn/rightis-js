# @rightis/sdk

**Use this before your code generates a real person's face, voice or persona**: image, video and voice generation, face swap, voice cloning, AI avatars and chat personas of real people or registered characters. Call it on the server, before the generation call.

Official JavaScript SDK for [Rightis](https://rightis.org), the public registry of identity rights. Ask whether a use of a person's likeness is cleared, request licences, record usage, and verify webhooks.

Node 20 or later, edge runtimes and browsers (keyless calls only in a browser: a secret key stays on the server). No runtime dependencies. ESM and CommonJS.

## 30-second quickstart

```bash
npm install @rightis/sdk
```

```ts
import { Rightis } from '@rightis/sdk';

const rightis = new Rightis(); // reads RIGHTIS_SECRET_KEY; keyless public resolve without it

const result = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'instagram ad',
  ai_methods: ['image_generation'],
  asset_types: ['face'],
  territory: ['US'],
});

switch (result.next_action.type) {
  case 'request_license': // allowed, requires_approval, unspecified: a licence is required
    console.log('Request a licence at', result.next_action.url);
    break;
  case 'stop': // denied
    console.log('Refused:', result.next_action.reason);
    break;
  case 'not_registered': // not registered is not permission
  case 'describe_use':
    console.log(result.next_action.reason);
    break;
}
```

| `decision` | `next_action.type` | Meaning |
|---|---|---|
| `allowed` | `request_license` | Pre-approved scopes. **Not free use**: still request the licence. |
| `requires_approval` | `request_license` | The holder decides each request. |
| `unspecified` | `request_license` | The holder has said nothing. Not a yes. |
| `denied` | `stop` | Refused. Do not generate. |
| `null` | `not_registered` | Not in the registry. **Not cleared.** |
| `null` | `describe_use` | No use described. Add `use_type`, `ai_methods`, `asset_types`. |

A failed lookup is not "not registered": on any error, do not generate.

Only have a name? `rightis.rights.search('name')` returns listed registrations with their Rights ID. No match is not clearance.

For a sandbox key and sample people: `npx rightis login`, `npx rightis init`, `npx rightis people` (see the [`rightis` CLI](https://www.npmjs.com/package/rightis)).

## Links

- Developers: https://rightis.org/en/developers
- Guide, generating real people: https://rightis.org/en/developers/guides/real-person-likeness
- For AI coding assistants: [Claude Code skill](https://github.com/Backers-Shawn/rightis-js/blob/main/skills/rightis/SKILL.md), [Cursor rule](https://github.com/Backers-Shawn/rightis-js/blob/main/.cursor/rules/rightis.mdc), [AGENTS.md](https://github.com/Backers-Shawn/rightis-js/blob/main/AGENTS.md) (Codex and others, with a snippet for your own AGENTS.md or CLAUDE.md)
- Source: https://github.com/Backers-Shawn/rightis-js

## "allowed" is not free use

`decision` folds every scope your use touches, most restrictive first: `denied > unspecified > requires_approval > allowed`.

`allowed` means the holder pre-authorised those scopes: **a licence request is approved without the holder reviewing it**, as long as the fee clears their floor. It does not mean you may use the likeness without a licence. `next_action.type` is `request_license` for `allowed` too, and `auto_approves` is a hint, not a guarantee. There is no `isAllowed()` helper on purpose. Training is answered separately in `result.training`.

## API

```ts
new Rightis({ apiKey?, baseUrl?, fetch?, timeoutMs?, maxRetries? })
```

- `apiKey` defaults to `process.env.RIGHTIS_SECRET_KEY` where `process` exists. `brk_test_...` is sandbox, `brk_live_...` is production. Pass `null` to force the keyless path.
- `baseUrl` defaults to `process.env.RIGHTIS_API_URL`, then `https://rightis.org`. A key is never sent over plain http to a non-local host.

| Method | Endpoint | Key |
|---|---|---|
| `rights.check(input)` | `POST /api/v1/rights/check` with a key, else `POST /api/public/v1/rights/resolve` | optional |
| `rights.lookup(rightsId)` | `GET /api/public/v1/rights/lookup` | no |
| `rights.search(q, { limit })` | `GET /api/public/v1/rights/search` | no |
| `licenses.request(input)` | `POST /api/v1/licenses/requests` | `license:request` |
| `licenses.verify(input)` | `POST /api/v1/licenses/verify` | `license:verify` |
| `usage.log(events)` | `POST /api/v1/usage` (1 to 500 events) | `usage:write` |
| `sandbox.people()` | `GET /api/v1/sandbox/people` | sandbox key |
| `webhooks.verify(opts)` | none, verified locally | no |

Money is a decimal string (`proposed_fee: "500000"`), never a number.

### Webhooks

Pass the **raw** body. Parsing and re-serialising changes the bytes and the signature will not match.

```ts
// Next.js route handler
export async function POST(req: Request) {
  const event = await rightis.webhooks.verify({
    payload: await req.text(),
    signatureHeader: req.headers.get('x-br-signature'),
    secret: process.env.RIGHTIS_WEBHOOK_SECRET!,
    // toleranceSec: 300 (default)
  });
  // Deliveries are retried: dedupe on event.event_id.
  return new Response(null, { status: 200 });
}
```

The header is `X-BR-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. `verify` checks the timestamp window and compares in constant time, and throws `RightisWebhookError` with a `code` on failure.

### Errors and retries

Every failure is a `RightisError` with `code`, `status`, `requestId`, `details` and `retryAfterSeconds`. Server codes pass through (`INSUFFICIENT_CREDIT` on 402, `RATE_LIMITED` on 429, `UNAUTHENTICATED`, `VALIDATION_ERROR`). SDK codes: `NETWORK_ERROR`, `TIMEOUT`, `MISSING_API_KEY`, `INVALID_ARGUMENT`.

Retries happen only where a repeat is safe: GETs, the keyless resolve, and `usage.log` (the server dedupes on `event_id`). They cover 429, 5xx and network errors, honour `Retry-After` up to 60 seconds, and otherwise back off exponentially. The keyed check (billed per call) and `licenses.*` are never retried, because the API has no idempotency key for them.

The SDK never logs your key, and the key is kept in a private field so it does not appear when the client is logged or serialised.

## License

MIT
