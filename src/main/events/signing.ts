import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Events out's signatures (Session 28, decision 20): Standard Webhooks' webhook-signature, and a GitHub-style
 * X-Drashti-Signature-256 beside it for a receiver that can only compute a plain HMAC of the body (n8n's
 * Crypto node). Each address has its own secret: whsec_ and 32 random bytes in base64, as the specification
 * writes them (https://www.standardwebhooks.com).
 */

/** A new address's secret. */
export const newSecret = (): string => `whsec_${randomBytes(32).toString('base64')}`;

const keyOf = (secret: string): Buffer => Buffer.from(secret.replace(/^whsec_/u, ''), 'base64');

/** Standard Webhooks' signature of a message: `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`. */
export function standardSignature(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', keyOf(secret))
    .update(`${id}.${String(timestamp)}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}

/** Whether `signature` (space-separated, any of them) signs this message with this secret: in constant time. */
export function verifyStandard(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const want = Buffer.from(standardSignature(secret, id, timestamp, body));
  return signature.split(' ').some((one) => {
    const got = Buffer.from(one);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The GitHub-style header's value: `sha256=` and the hex HMAC-SHA256 of the body, keyed by the secret as written. */
export const githubStyleSignature = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
