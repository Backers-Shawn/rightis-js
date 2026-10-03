import { RightisWebhookError } from './errors.js';
import type { WebhookEvent } from './types.js';

/** The header Rightis signs every delivery with. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-BR-Signature';
/** Default tolerance between the signed timestamp and now, in seconds. */
export const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;

export interface VerifyWebhookOptions {
  /** The raw request body, exactly as received. Not parsed JSON: re-serialising changes the bytes. */
  payload: string | Uint8Array;
  /** The value of the `X-BR-Signature` header: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
  signatureHeader: string | null | undefined;
  /** The endpoint's signing secret from the Rightis console. */
  secret: string;
  /** Allowed clock difference in seconds. Default 300. */
  toleranceSec?: number;
  /** @internal Test hook. */
  nowMs?: number;
}

interface ParsedHeader {
  t: number;
  v1: string[];
}

function parseHeader(header: string): ParsedHeader | null {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) t = Number(value);
    if (key === 'v1' && value) v1.push(value);
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time for equal lengths. Length is not secret (always 32 bytes for SHA-256). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** The slice of Web Crypto we use, typed here so no DOM lib is needed. */
interface HmacSubtle {
  importKey(format: 'raw', key: Uint8Array, alg: { name: 'HMAC'; hash: 'SHA-256' }, extractable: false, usages: ['sign']): Promise<unknown>;
  sign(alg: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): HmacSubtle {
  const c = (globalThis as { crypto?: { subtle?: HmacSubtle } }).crypto;
  if (!c?.subtle) {
    throw new RightisWebhookError('WEBHOOK_SIGNATURE_MISMATCH', 'Web Crypto is not available in this runtime (Node 20+ required)');
  }
  return c.subtle;
}

/**
 * Verifies a Rightis webhook delivery and returns the parsed event.
 *
 * Checks, in order: the header is present and well formed, the timestamp is
 * within `toleranceSec`, and `HMAC-SHA256(secret, "<t>.<payload>")` matches a
 * `v1` value (constant-time). Throws `RightisWebhookError` on any failure.
 * Works in Node 20+, edge runtimes and browsers (Web Crypto).
 *
 * After verifying, dedupe on `event.event_id`: deliveries are retried.
 */
export async function verifyWebhook<T = unknown>(opts: VerifyWebhookOptions): Promise<WebhookEvent<T>> {
  const { signatureHeader, secret } = opts;
  if (typeof opts.payload !== 'string' && !(opts.payload instanceof Uint8Array)) {
    throw new RightisWebhookError(
      'WEBHOOK_PAYLOAD_INVALID',
      'payload must be the raw body string (or bytes), not parsed JSON. Read the body with req.text().',
    );
  }
  if (!secret) throw new RightisWebhookError('WEBHOOK_SIGNATURE_MISMATCH', 'secret is required');
  if (!signatureHeader) {
    throw new RightisWebhookError('WEBHOOK_SIGNATURE_MISSING', `Missing ${WEBHOOK_SIGNATURE_HEADER} header`);
  }
  const parsed = parseHeader(signatureHeader);
  if (!parsed) {
    throw new RightisWebhookError('WEBHOOK_SIGNATURE_MALFORMED', `${WEBHOOK_SIGNATURE_HEADER} must look like t=<seconds>,v1=<hex>`);
  }

  const tolerance = opts.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - parsed.t) > tolerance) {
    throw new RightisWebhookError('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE', 'Signature timestamp is outside the tolerance window');
  }

  const payload = typeof opts.payload === 'string' ? opts.payload : new TextDecoder().decode(opts.payload);
  const enc = new TextEncoder();
  const key = await subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await subtle().sign('HMAC', key, enc.encode(`${parsed.t}.${payload}`)));

  let matched = false;
  for (const candidate of parsed.v1) {
    const bytes = hexToBytes(candidate);
    // Evaluate every candidate; do not short-circuit on the first match.
    if (bytes && timingSafeEqual(bytes, expected)) matched = true;
  }
  if (!matched) throw new RightisWebhookError('WEBHOOK_SIGNATURE_MISMATCH', 'Signature does not match the payload');

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new RightisWebhookError('WEBHOOK_PAYLOAD_INVALID', 'Signed payload is not valid JSON');
  }
  if (!event || typeof event !== 'object' || typeof (event as WebhookEvent).event_id !== 'string') {
    throw new RightisWebhookError('WEBHOOK_PAYLOAD_INVALID', 'Signed payload is not a Rightis event');
  }
  return event as WebhookEvent<T>;
}
