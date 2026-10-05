import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type LoopbackFailure = 'state_mismatch' | 'issuer_mismatch' | 'authorization_error' | 'missing_code' | 'timeout';

export class LoopbackError extends Error {
  constructor(
    readonly reason: LoopbackFailure,
    message: string,
  ) {
    super(message);
    this.name = 'LoopbackError';
  }
}

export interface Loopback {
  port: number;
  /** `http://127.0.0.1:<port>/callback`. */
  redirectUri: string;
  /** Resolves with the authorization code, rejects with `LoopbackError`. Settles once. */
  code: Promise<string>;
  close(): void;
}

/**
 * Listens on 127.0.0.1 on a free port for the single OAuth redirect.
 *
 * The first request to /callback settles the flow. A wrong `state` rejects
 * it: that request did not come from the authorization we started.
 */
export async function startLoopback(opts: {
  state: string;
  /** When the redirect carries `iss` (RFC 9207), it must equal this. */
  issuer?: string;
  timeoutMs?: number;
}): Promise<Loopback> {
  const host = '127.0.0.1';
  let resolve!: (code: string) => void;
  let reject!: (e: LoopbackError) => void;
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The caller may never await `code` if it bails out early; do not crash on that.
  code.catch(() => {});
  let settled = false;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const send = (status: number, text: string) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        connection: 'close',
      });
      res.end(renderPage(status, text));
    };
    if (req.method !== 'GET' || url.pathname !== '/callback') return send(404, 'Not found');
    if (settled) return send(400, 'This login has already finished. You can close this tab.');

    const fail = (reason: LoopbackFailure, message: string) => {
      settled = true;
      send(400, `Rightis CLI: login failed. ${message}`);
      reject(new LoopbackError(reason, message));
      shutdown();
    };
    const p = url.searchParams;
    if (p.get('state') !== opts.state) return fail('state_mismatch', 'The state parameter did not match this login.');
    if (opts.issuer && p.has('iss') && p.get('iss') !== opts.issuer) {
      return fail('issuer_mismatch', 'The response came from a different authorization server.');
    }
    const error = p.get('error');
    if (error) {
      const desc = p.get('error_description');
      return fail('authorization_error', desc ? `${error}: ${desc}` : error);
    }
    const value = p.get('code');
    if (!value) return fail('missing_code', 'No authorization code in the redirect.');

    settled = true;
    send(200, 'Rightis CLI: login complete. You can close this tab and return to the terminal.');
    resolve(value);
    shutdown();
  });

  let timer: NodeJS.Timeout | undefined;
  const shutdown = () => {
    if (timer) clearTimeout(timer);
    server.close();
    server.closeIdleConnections?.();
  };

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, host, () => res());
  });
  const port = (server.address() as AddressInfo).port;
  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new LoopbackError('timeout', 'Timed out waiting for the browser.'));
    shutdown();
  }, opts.timeoutMs ?? 5 * 60_000);
  timer.unref();

  return {
    port,
    redirectUri: `http://${host}:${port}/callback`,
    code,
    close: () => {
      if (!settled) {
        settled = true;
        reject(new LoopbackError('timeout', 'Login was cancelled.'));
      }
      shutdown();
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * The page the browser lands on after consent. It runs on the user's own
 * machine, so it is self-contained: no scripts, no external assets, inline
 * styles only (the CSP above allows nothing else).
 */
export function renderPage(status: number, text: string): string {
  const ok = status === 200;
  const title = ok ? 'You are signed in' : status === 404 ? 'Nothing here' : 'Sign-in did not finish';
  const lead = text.replace(/^Rightis CLI: /, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rightis CLI</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8fa; --card:#fff; --ink:#0f172a; --soft:#64748b; --line:#e2e8f0; --accent:${ok ? '#317ae7' : '#dc2626'}; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0f17; --card:#111827; --ink:#f1f5f9; --soft:#94a3b8; --line:#1f2937; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--ink);
         font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Pretendard", "Segoe UI", system-ui, sans-serif; }
  main { width:100%; max-width:420px; text-align:center; }
  .brand { font-weight:700; letter-spacing:.18em; font-size:18px; margin-bottom:28px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:32px 28px; }
  .mark { width:44px; height:44px; border-radius:50%; margin:0 auto 18px; display:grid; place-items:center; background:var(--accent); color:#fff; font-size:22px; font-weight:700; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:var(--soft); }
  .hint { margin-top:18px; font-size:13px; }
</style>
</head>
<body>
<main>
  <div class="brand">RIGHTIS</div>
  <div class="card">
    <div class="mark" aria-hidden="true">${ok ? '&#10003;' : '!'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(lead)}</p>
    ${ok ? '<p class="hint">Rightis CLI</p>' : '<p class="hint">Run <code>rightis login</code> again in your terminal.</p>'}
  </div>
</main>
</body>
</html>
`;
}
