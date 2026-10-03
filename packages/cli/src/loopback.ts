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
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      res.end(`${text}\n`);
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
