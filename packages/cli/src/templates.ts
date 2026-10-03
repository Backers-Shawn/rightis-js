/** Example files `rightis init` writes. Each calls rights.check against one sandbox person. */

const ALLOWED_NOTE = [
  '"allowed" is not free use. It means a licence request in these scopes is',
  'approved without the holder reviewing it (if the fee clears their floor).',
  'next_action.type is still "request_license". Follow next_action.',
];

export function exampleScript(rightsId: string): string {
  return `// Written by \`rightis init\`.
// Run: node --env-file=.env.local rightis-example.mjs
import { Rightis } from '@rightis/sdk';

// Reads RIGHTIS_SECRET_KEY from the environment. Server-side only.
const rightis = new Rightis();

const result = await rightis.rights.check({
  rights_id: '${rightsId}',
  use_type: 'social media ad',
  asset_types: ['face'],
});

console.log('decision:   ', result.decision);
console.log('next action:', result.next_action.type, result.next_action.url ?? '');
console.log('reason:     ', result.next_action.reason);
for (const s of result.scopes) console.log('  ', s.scope, s.state);

${ALLOWED_NOTE.map((l) => `// ${l}`).join('\n')}
`;
}

export function exampleNextRoute(rightsId: string): string {
  return `// Written by \`rightis init --framework next\`.
// POST /api/rightis-check  { "rights_id": "...", "use_type": "..." }
import { Rightis } from '@rightis/sdk';

// Reads RIGHTIS_SECRET_KEY from the environment. Keep this on the server.
const rightis = new Rightis();

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { rights_id?: string; use_type?: string };
  const result = await rightis.rights.check({
    rights_id: body.rights_id ?? '${rightsId}',
    use_type: body.use_type ?? 'social media ad',
    asset_types: ['face'],
  });
${ALLOWED_NOTE.map((l) => `  // ${l}`).join('\n')}
  return Response.json({
    decision: result.decision,
    next_action: result.next_action,
    scopes: result.scopes,
  });
}
`;
}
