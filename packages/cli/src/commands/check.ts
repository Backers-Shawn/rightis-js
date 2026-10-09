import { Rightis, type AssetType, type RightsCheckResult } from '@rightis/sdk';

import { list, str } from '../args.js';
import { resolveBaseUrl } from '../config.js';
import { loadSecretKey } from '../envfile.js';
import { UsageError } from '../errors.js';
import { table } from '../format.js';
import type { Io } from '../io.js';
import type { Command } from './types.js';

const ASSETS: readonly AssetType[] = ['face', 'voice', 'style', 'image'];

const ALLOWED_NOT_FREE =
  'allowed is not free use: request the licence. It is approved without the holder reviewing it if the fee clears their floor.';

export function printCheck(io: Io, r: RightsCheckResult, source: string, askedId?: string): void {
  // 키 있는 check 의 옛 서버는 맨 위 rights_id 를 싣지 않았다. 물은 값으로 채운다.
  const rightsId = r.rights_id ?? r.matched_entity?.rights_id ?? askedId ?? '';
  // A server that has not adopted the Resolve contract on the keyed path yet.
  if (!r.next_action || !('decision' in r)) {
    io.out(table([['rights id', rightsId], ['rights status', String(r.rights_status ?? 'unknown')], ['source', source]]).join('\n'));
    io.out('');
    io.out('This server returned the legacy check format without a decision. Use --public, or update the server.');
    return;
  }
  const who = r.identity
    ? `${r.identity.display_name}${r.identity.identity_verified ? ' (verified)' : ''}${r.identity.managed_by ? `, managed by ${r.identity.managed_by}` : ''}`
    : 'not registered';
  const rows: string[][] = [
    ['rights id', rightsId],
    ['identity', who],
    ['decision', r.decision ?? 'none'],
    ['next action', r.next_action.url ? `${r.next_action.type}  ${r.next_action.url}` : r.next_action.type],
    ['', r.next_action.reason],
  ];
  if (r.registered) {
    rows.push(['training', `${r.training.decision} (do not train: ${r.training.do_not_train ? 'yes' : 'no'})`]);
  }
  if ((r.unmapped ?? []).length > 0) rows.push(['unmapped', (r.unmapped ?? []).join(', ')]);
  rows.push(['source', source]);
  io.out(table(rows).join('\n'));

  if ((r.scopes ?? []).length > 0) {
    io.out('');
    io.out(table([['SCOPE', 'STATE'], ...(r.scopes ?? []).map((s) => [String(s.scope), String(s.state)])]).join('\n'));
  }
  const notes = [...(r.notes ?? [])];
  if (r.decision === 'allowed' && !notes.some((n) => /free use/i.test(n))) notes.push(ALLOWED_NOT_FREE);
  if (notes.length > 0) {
    io.out('');
    io.out('Notes:');
    for (const n of notes) io.out(`  - ${n}`);
  }
}

export const checkCommand: Command = {
  name: 'check',
  summary: 'Ask whether a use of an identity is cleared',
  help: `Usage: rightis check <rights_id> [--use <use_type>] [--asset face|voice|style|image ...] [--method <ai_method> ...] [--training] [--json] [--public]

Asks Rightis for a decision and the next action. With a key in
RIGHTIS_SECRET_KEY or .env.local this uses the keyed check; otherwise the
keyless public resolve. Exit code is 0 for every decision (it is information)
and non-zero only on errors.

"allowed" is not free use. It means a licence request in those scopes is
approved without the holder reviewing it. The next action is still to request
the licence.

Options:
  --use <text>      What you intend to do, for example "instagram ad"
  --asset <type>    face, voice, style or image. Repeat for several
  --method <name>   How it is generated, for example image_generation,
                    video_generation or voice_synthesis. Repeat for several.
                    Without it the answer covers only what --use implies
  --training        You intend to train on the identity
  --json            Print the raw JSON response
  --public          Ignore any API key and use the keyless public resolve
                    (a sandbox key only knows the sandbox people)`,
  options: {
    use: { type: 'string' },
    asset: { type: 'string', multiple: true },
    method: { type: 'string', multiple: true },
    training: { type: 'boolean' },
    json: { type: 'boolean' },
    public: { type: 'boolean' },
  },
  async run(io, args) {
    const [rightsId, ...extra] = args.positionals;
    if (!rightsId) throw new UsageError('Missing <rights_id>. Example: rightis check BR-XXXX-XXXX-XXXX --use "instagram ad"');
    if (extra.length > 0) throw new UsageError(`Unexpected argument: ${extra[0]}`);
    const assets = list(args.values.asset);
    for (const a of assets) {
      if (!(ASSETS as readonly string[]).includes(a)) throw new UsageError(`--asset must be one of ${ASSETS.join(', ')} (got ${a})`);
    }
    const methods = [...new Set(list(args.values.method).map((m) => m.trim()).filter(Boolean))];
    const baseUrl = resolveBaseUrl(str(args.values['base-url']), io.env);
    const found = args.values.public ? null : await loadSecretKey(io.cwd, io.env);
    const rightis = new Rightis({ apiKey: found?.key ?? null, baseUrl, fetch: io.fetch });
    const result = await rightis.rights.check({
      rights_id: rightsId,
      ...(str(args.values.use) ? { use_type: str(args.values.use) } : {}),
      ...(assets.length > 0 ? { asset_types: [...new Set(assets)] as AssetType[] } : {}),
      ...(methods.length > 0 ? { ai_methods: methods } : {}),
      ...(args.values.training ? { for_training: true } : {}),
    });
    if (args.values.json) {
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    const source = found
      ? `keyed check (${rightis.environment ?? 'unknown'} key from ${found.source})`
      : 'public resolve (no API key)';
    printCheck(io, result, source, rightsId);
    return 0;
  },
};
