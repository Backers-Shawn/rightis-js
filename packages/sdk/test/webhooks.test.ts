import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { Rightis, RightisWebhookError, verifyWebhook } from '../src/index.js';

const SECRET = 'whsec_test_secret';
const NOW = 1_790_000_000_000;
const T = Math.floor(NOW / 1000);
const BODY = JSON.stringify({
  event_id: 'evt_1',
  event_type: 'license.activated',
  created_at: '2026-10-03T00:00:00.000Z',
  data: { license_public_code: 'L-ABC' },
});

function sign(body: string, t = T, secret = SECRET) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RightisWebhookError);
    return (e as RightisWebhookError).code;
  }
  throw new Error('expected rejection');
}

describe('webhooks.verify', () => {
  it('accepts a valid signature and returns the parsed event', async () => {
    const event = await verifyWebhook<{ license_public_code: string }>({
      payload: BODY,
      signatureHeader: sign(BODY),
      secret: SECRET,
      nowMs: NOW,
    });
    expect(event.event_id).toBe('evt_1');
    expect(event.data.license_public_code).toBe('L-ABC');
  });

  it('is reachable from the client and accepts raw bytes', async () => {
    const rightis = new Rightis({ apiKey: null });
    const event = await rightis.webhooks.verify({
      payload: new TextEncoder().encode(BODY),
      signatureHeader: sign(BODY),
      secret: SECRET,
      nowMs: NOW,
    });
    expect(event.event_type).toBe('license.activated');
  });

  it('accepts when any of several v1 values matches (secret rotation)', async () => {
    const header = `t=${T},v1=${'0'.repeat(64)},${sign(BODY).split(',')[1]}`;
    await expect(verifyWebhook({ payload: BODY, signatureHeader: header, secret: SECRET, nowMs: NOW })).resolves.toBeTruthy();
  });

  it('rejects a tampered body', async () => {
    const tampered = BODY.replace('L-ABC', 'L-XYZ');
    expect(await code(verifyWebhook({ payload: tampered, signatureHeader: sign(BODY), secret: SECRET, nowMs: NOW }))).toBe(
      'WEBHOOK_SIGNATURE_MISMATCH',
    );
  });

  it('rejects the wrong secret', async () => {
    expect(
      await code(verifyWebhook({ payload: BODY, signatureHeader: sign(BODY, T, 'other'), secret: SECRET, nowMs: NOW })),
    ).toBe('WEBHOOK_SIGNATURE_MISMATCH');
  });

  it('rejects a timestamp outside the tolerance, in either direction', async () => {
    const old = T - 301;
    expect(await code(verifyWebhook({ payload: BODY, signatureHeader: sign(BODY, old), secret: SECRET, nowMs: NOW }))).toBe(
      'WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE',
    );
    const future = T + 301;
    expect(
      await code(verifyWebhook({ payload: BODY, signatureHeader: sign(BODY, future), secret: SECRET, nowMs: NOW })),
    ).toBe('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE');
    // A custom tolerance widens the window.
    await expect(
      verifyWebhook({ payload: BODY, signatureHeader: sign(BODY, old), secret: SECRET, nowMs: NOW, toleranceSec: 600 }),
    ).resolves.toBeTruthy();
  });

  it('rejects a signature whose timestamp was swapped (t is signed)', async () => {
    const v1 = sign(BODY).split(',')[1];
    expect(
      await code(verifyWebhook({ payload: BODY, signatureHeader: `t=${T + 10},${v1}`, secret: SECRET, nowMs: NOW })),
    ).toBe('WEBHOOK_SIGNATURE_MISMATCH');
  });

  it('rejects missing and malformed headers', async () => {
    expect(await code(verifyWebhook({ payload: BODY, signatureHeader: undefined, secret: SECRET, nowMs: NOW }))).toBe(
      'WEBHOOK_SIGNATURE_MISSING',
    );
    for (const bad of ['garbage', `v1=${'a'.repeat(64)}`, `t=${T}`, `t=abc,v1=${'a'.repeat(64)}`]) {
      expect(await code(verifyWebhook({ payload: BODY, signatureHeader: bad, secret: SECRET, nowMs: NOW }))).toBe(
        'WEBHOOK_SIGNATURE_MALFORMED',
      );
    }
    // Non-hex or wrong-length v1 never matches.
    for (const v1 of ['zz'.repeat(32), 'ab', 'a'.repeat(63)]) {
      expect(
        await code(verifyWebhook({ payload: BODY, signatureHeader: `t=${T},v1=${v1}`, secret: SECRET, nowMs: NOW })),
      ).toBe('WEBHOOK_SIGNATURE_MISMATCH');
    }
  });

  it('refuses parsed JSON instead of the raw body', async () => {
    expect(
      await code(
        verifyWebhook({ payload: JSON.parse(BODY) as unknown as string, signatureHeader: sign(BODY), secret: SECRET, nowMs: NOW }),
      ),
    ).toBe('WEBHOOK_PAYLOAD_INVALID');
  });

  it('refuses a correctly signed body that is not an event', async () => {
    const body = '"just a string"';
    expect(await code(verifyWebhook({ payload: body, signatureHeader: sign(body), secret: SECRET, nowMs: NOW }))).toBe(
      'WEBHOOK_PAYLOAD_INVALID',
    );
  });
});
