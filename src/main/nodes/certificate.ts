import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';

/*
 * Main's own certificate for the node link (Session 13). Node's crypto can
 * read certificates but not make them, so this writes one directly in DER:
 * an X.509 v3 certificate for an ECDSA P-256 key, signed by itself, marked as
 * its own authority so a node can trust exactly this one certificate (its
 * pin) and nothing else. Nobody else's trust is needed: both ends are
 * Drashti, and a node checks the certificate by its fingerprint, never by a
 * name or an address.
 */

export interface Identity {
  certPem: string;
  keyPem: string;
  /** SHA-256 of the certificate (DER), hexadecimal: what a node pins. */
  fingerprint: string;
}

// ---- DER, as little as a certificate needs -------------------------------------------------

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), length(body.length), body]);
const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
const explicit = (n: number, body: Buffer): Buffer => tlv(0xa0 + n, body);
const utf8 = (text: string): Buffer => tlv(0x0c, Buffer.from(text, 'utf8'));
const octets = (body: Buffer): Buffer => tlv(0x04, body);
const bool = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const bits = (body: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), body]));

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const [a = 0, b = 0, ...rest] = parts;
  const out = [40 * a + b];
  for (const v of rest) {
    const chunk = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) chunk.unshift((x & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** A positive INTEGER from big-endian bytes. */
function integer(bytes: Buffer): Buffer {
  let b = bytes;
  while (b.length > 1 && b[0] === 0 && ((b[1] ?? 0) & 0x80) === 0) b = b.subarray(1);
  if (((b[0] ?? 0) & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

/** GeneralizedTime, as certificates write years past 2049 (and any year). */
function time(at: Date): Buffer {
  const text = at.toISOString().replace(/[-:T]/gu, '').slice(0, 14);
  return tlv(0x18, Buffer.from(`${text}Z`, 'ascii'));
}

const ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const COMMON_NAME = '2.5.4.3';
const BASIC_CONSTRAINTS = '2.5.29.19';
const KEY_USAGE = '2.5.29.15';

/** The DER of a certificate, as PEM. */
export function toPem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/gu) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** SHA-256 of a certificate's DER, hexadecimal. */
export const certificateFingerprint = (der: Buffer): string => createHash('sha256').update(der).digest('hex');

/** The fingerprint of a certificate given as PEM. */
export function pemFingerprint(pem: string): string {
  return certificateFingerprint(new X509Certificate(pem).raw);
}

/**
 * A new key and a certificate for it, signed by itself, valid from a day
 * ago (a node's clock may be a little behind) for 30 years: it is pinned, so
 * it must not run out while the mandir uses it.
 */
export function makeIdentity(name: string, now = new Date()): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const algorithm = sequence(oid(ECDSA_WITH_SHA256));
  const subject = sequence(set(sequence(oid(COMMON_NAME), utf8(name.slice(0, 64) || 'Drashti Main'))));
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime());
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 30);
  const extensions = explicit(
    3,
    sequence(
      // Its own authority (a node trusts exactly this certificate), and no others below it.
      sequence(oid(BASIC_CONSTRAINTS), bool(true), octets(sequence(bool(true), tlv(0x02, Buffer.from([0]))))),
      // Signing (the TLS handshake) and certificates (itself).
      sequence(oid(KEY_USAGE), bool(true), octets(bits(Buffer.from([0x84]), 2))),
    ),
  );
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    algorithm,
    subject,
    sequence(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, algorithm, bits(signature));
  return {
    certPem: toPem(der),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: certificateFingerprint(der),
  };
}
