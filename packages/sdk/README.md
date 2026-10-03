# @rightis/sdk

Official JavaScript SDK for [Rightis](https://rightis.org), the identity-rights registry. Ask whether a use of a person's likeness is cleared, request licences, record usage, and verify webhooks.

> **Not on npm yet.** This package will be published as `@rightis/sdk@0.1.0`. The keyless calls (`rights.check` without a key, `rights.lookup`, `rights.search`) work against rightis.org today. The keyed `rights.check` returns the Resolve fields once the server release that adds them ships; `sandbox.people()` and `RightisConsole` need that release too.

Node 20 or later, edge runtimes and browsers. No runtime dependencies. ESM and CommonJS.

## Quickstart

1. `npx rightis login` to sign in.
2. `npx rightis init` to write a sandbox key (`RIGHTIS_SECRET_KEY`) to `.env.local`.
3. `npx rightis people` to see the sandbox sample people.
4. `npx rightis check BR-SANDBOX-... --use "social media ad" --asset face` for a first check in the terminal.
5. Then in code:

```ts
import { Rightis } from '@rightis/sdk';

const rightis = new Rightis(); // reads RIGHTIS_SECRET_KEY; server-side only

const result = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'social media ad',
  asset_types: ['face'],
  territory: ['US'],
});

switch (result.next_action.type) {
  case 'request_license': // includes decision "allowed"
    console.log('Request a licence at', result.next_action.url);
    break;
  case 'stop':
    console.log('Refused:', result.next_action.reason);
    break;
  case 'not_registered': // not registered is not permission
  case 'describe_use':
    console.log(result.next_action.reason);
    break;
}
```

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
