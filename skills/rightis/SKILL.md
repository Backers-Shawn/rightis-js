---
name: rightis
description: Check a real person's identity rights with Rightis (rightis.org) before code generates or edits their likeness. Use when writing or reviewing code that generates or edits images, video, audio or chat personas of real people or named characters, including face swap, deepfake, voice clone, text-to-speech in someone's voice, digital humans, AI avatars of real people, celebrity or influencer likeness, lookalike ads, and character IP. Covers the @rightis/sdk calls, the rightis CLI, where the check goes in code, and how to read decision and next_action.
---

# Rightis: check identity rights before generating a real person

Rightis (https://rightis.org) is a public registry of identity rights. People and
rights holders register a face, voice, persona or character and say which AI uses
they allow, want to approve, or refuse. Services ask Rightis before they generate.

## The rule

When code generates or edits the face, voice or persona of a real person (or a
registered character), put a Rightis check **before the generation call, on the
server**, and act on `next_action`. Never generate on the strength of the check
alone: the path to use always goes through a licence.

Three things that look like permission and are not:

- `decision: "allowed"` is **not free use**. It means a licence request in those
  scopes is approved without the holder reviewing it, provided the fee clears
  their floor. You still request the licence.
- `decision: "unspecified"` is **not permission**. The holder has said nothing.
- `next_action.type: "not_registered"` is **not cleared**. Rightis answers only for
  identities their holders chose to list. Treat the person as not cleared for AI use.

A failed lookup (network error, timeout, 5xx, 429, 402) is **not** "not registered".
Fail closed: do not generate, surface the error, retry later.

## Decision table

`decision` folds every scope the use touches, most restrictive wins:
`denied > unspecified > requires_approval > allowed`.

| `decision` | `next_action.type` | What the code does | What to tell the user |
|---|---|---|---|
| `allowed` | `request_license` (`auto_approves: true` is a hint, not a guarantee) | Block generation until a licence is active. Send the user to `next_action.url` or file `licenses.request`. | "This person pre-approved this kind of use. A licence is still required; the request is approved without their review if the fee clears their floor." |
| `requires_approval` | `request_license` | Block until the holder approves and the licence is active. | "The rights holder decides each request. Request a licence and wait for approval." |
| `unspecified` | `request_license` | Block. Ask the holder. | "The holder has not said anything about this use. That is not a yes. Request a licence." |
| `denied` | `stop` | Do not generate. Do not offer a workaround that recreates the person. | "The rights holder refuses this use." |
| `null` | `not_registered` | Do not generate their likeness. | "This person is not in the Rightis registry. That does not mean the use is cleared." |
| `null` | `describe_use` | Re-ask with `use_type`, `ai_methods`, `asset_types`, `territory`. | (internal: the use was not described) |

Also read: `unmapped` (terms Rightis could not map, so a person decides),
`training.decision` and `training.do_not_train` (training is a separate right from
generation; pass `for_training: true` if you train), and `notes`.

## SDK (`@rightis/sdk`, Node 20+, server side only)

```bash
npm install @rightis/sdk
```

```ts
import { Rightis, RightisError } from '@rightis/sdk';

// Reads RIGHTIS_SECRET_KEY (brk_test_ sandbox, brk_live_ production).
// With no key, rights.check uses the keyless public resolve.
const rightis = new Rightis();

const result = await rightis.rights.check({
  rights_id: 'BR-XXXX-XXXX-XXXX',
  use_type: 'instagram ad',             // free text
  ai_methods: ['image_generation'],     // video_generation, voice_synthesis, style_transfer, ...
  asset_types: ['face'],                // face | voice | style | image
  territory: ['US'],                    // ISO codes; outside the holder's country adds international_use
  // for_training: true,                // only if you train on the identity
});

switch (result.next_action.type) {
  case 'request_license': /* allowed, requires_approval, unspecified */ break;
  case 'stop':            /* denied */ break;
  case 'not_registered':  /* not cleared */ break;
  case 'describe_use':    /* add use_type / ai_methods / asset_types */ break;
}
```

Only a name? `rightis.rights.search('name', { limit: 5 })` (keyless) returns listed
registrations with `rights_id`. No match is not clearance. `rights.lookup(rightsId)`
lists a holder's states; use `check` for a judgement on a specific use.

Other calls: `licenses.request(input)` (scope `license:request`, money as a decimal
string like `"500000"`), `licenses.verify({ license_public_code })` (scope
`license:verify`), `usage.log(events)` (scope `usage:write`, 1 to 500 events),
`sandbox.people()` (sandbox key), `webhooks.verify({ payload, signatureHeader, secret })`
with the raw body and header `x-br-signature`. Errors are `RightisError` with `code`
(`NETWORK_ERROR`, `TIMEOUT`, `RATE_LIMITED`, `INSUFFICIENT_CREDIT`, `UNAUTHENTICATED`,
`VALIDATION_ERROR`, `MISSING_API_KEY`, `INVALID_ARGUMENT`). There is no `isAllowed()`
helper on purpose; do not write one that maps `allowed` to true.

## Where the check goes

- Server side, immediately before the call to the image, video, voice or chat model,
  in the same request handler or job. Never in the browser: the key is secret.
- Gate on a licence, not on the decision. The go path is: the app holds a licence
  code for this person and use, `licenses.verify` returns `valid: true`, then
  generate, then `usage.log` the event.
- Run it for every generation that names or depicts a real person, including user
  prompts like "make a video of <celebrity>". Resolve the name with `rights.search`
  first; if there is no Rights ID, do not treat that as cleared.
- Wrap the call so that any `RightisError` blocks generation (fail closed).

```ts
// licenseCode: the L-/PL- code your app stored for this rights_id and use
async function assertCleared(rightsId: string, licenseCode: string | null) {
  const r = await rightis.rights.check({ rights_id: rightsId, use_type: 'in-app avatar',
    ai_methods: ['image_generation'], asset_types: ['face'] });
  if (r.next_action.type !== 'request_license') throw new Error(r.next_action.reason);
  if (!licenseCode) throw new Error(`Licence required: ${r.next_action.url ?? 'request one on Rightis'}`);
  const v = await rightis.licenses.verify({ license_public_code: licenseCode });
  if (!v.valid) throw new Error(`Licence ${licenseCode} is ${v.license_status}`);
}
// any throw above, including RightisError, means: do not generate
```

## CLI (`rightis`)

```bash
npx rightis check BR-XXXX-XXXX-XXXX --use "instagram ad" --asset face --public
npx rightis check BR-XXXX-XXXX-XXXX --use "podcast ad" --asset voice --json
npx rightis login && npx rightis init   # sandbox key into .env.local (must be gitignored)
npx rightis people                      # sandbox sample people, needs a brk_test_ key
```

`check` options: `--use`, `--asset face|voice|style|image` (repeatable), `--training`,
`--json`, `--public` (ignore any key; a sandbox key only knows sandbox people).
Exit code is 0 for every decision and non-zero only on errors.

## MCP

Keyless public MCP server: `https://rightis.org/api/public-mcp/mcp` with tools
`rights_lookup`, `rights_search`, `registry_info`.

## Links

- Developers: https://rightis.org/en/developers
- Guide: https://rightis.org/en/developers/guides/real-person-likeness
- Source: https://github.com/Backers-Shawn/rightis-js
