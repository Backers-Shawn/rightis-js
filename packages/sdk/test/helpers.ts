import type { FetchLike } from '../src/http.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = Response | Error | ((call: RecordedCall) => Response | Error);

/** A fetch that replays canned replies in order and records each call. No network. */
export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch #${calls.length} to ${call.url}`);
    const r = typeof next === 'function' ? next(call) : next;
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetch, calls };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const SANDBOX_KEY = 'brk_test_0123456789ABCDEFGHIJKL.0123456789abcdefghijklmnopqrstuv';

export const NOT_REGISTERED = {
  rights_id: 'BR-0000-0000-0000',
  registered: false,
  identity: null,
  decision: null,
  scopes: [],
  unmapped: [],
  training: { decision: 'unspecified', do_not_train: true },
  next_action: { type: 'not_registered', url: null, reason: 'No listed registration for this rights_id.' },
  profile_url: null,
  notes: [],
};

export const noSleep = { sleep: async () => {}, random: () => 0 };
