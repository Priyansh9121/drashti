import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Pairing a node (Session 13): the code Main shows, typed on the node,
 * drives CPace, a password-authenticated key exchange (draft-irtf-cfrg-cpace),
 * here over the 2048-bit MODP group of RFC 3526. The group's generator is a
 * hash of the code and of Main's certificate fingerprint, as the node saw it
 * over TLS and as Main knows it, so the two sides agree on a key only when
 * both the code and the certificate are the same. Each side then proves it
 * has the key.
 *
 * A short code alone could not protect the certificate: someone between the
 * node and Main while they pair could relay the exchange and work the code
 * out offline from what they saw, in milliseconds, then have their own
 * certificate pinned. Here every try tests one guess of the code and nothing
 * more, and Main drops the code after ten wrong tries.
 */

/** RFC 3526 group 14: a safe prime p = 2q + 1. */
const P = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AACAA68FFFFFFFFFFFFFFFF',
);
const Q = (P - 1n) / 2n;
/** The group's size in bytes: shares are this long, as hexadecimal of twice as many digits. */
const BYTES = 256;
const LABEL = 'drashti-node-pair/1';

/** The group's prime, as hexadecimal (a test checks it against the platform's own copy). */
export const GROUP_PRIME_HEX = P.toString(16);

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
  }
  return result;
}

const toHex = (n: bigint): string => n.toString(16).padStart(BYTES * 2, '0');

/** The generator for this code and certificate: a hash of both, squared into the subgroup of prime order q. */
export function generator(code: string, fingerprint: string): bigint {
  const parts: Buffer[] = [];
  for (let i = 0; parts.length * 64 < BYTES + 32; i++)
    parts.push(
      createHash('sha512')
        .update(Buffer.from([i]))
        .update(`${LABEL} generator\0${code}\0${fingerprint.toLowerCase()}`)
        .digest(),
    );
  const h = BigInt(`0x${Buffer.concat(parts).toString('hex')}`) % P;
  return (h * h) % P;
}

/** One side's secret and the share it sends (hexadecimal). */
export interface PakeStart {
  secret: bigint;
  share: string;
}

export function startPake(code: string, fingerprint: string): PakeStart {
  const g = generator(code, fingerprint);
  let secret = 0n;
  // 320 random bits: short exponents are sound in this group, and fast.
  while (secret === 0n) secret = BigInt(`0x${randomBytes(40).toString('hex')}`);
  return { secret, share: toHex(modPow(g, secret, P)) };
}

/** A share the other side sent, if it is a member of the group (never 0, 1 or p - 1). */
export function readShare(hex: unknown): bigint | null {
  if (typeof hex !== 'string' || !/^[0-9a-f]{1,512}$/u.test(hex)) return null;
  const v = BigInt(`0x${hex}`);
  if (v <= 1n || v >= P - 1n) return null;
  return modPow(v, Q, P) === 1n ? v : null;
}

/**
 * The key both sides make: equal only when both used the same code and
 * fingerprint. Null when their share is not one.
 */
export function pakeKey(
  own: PakeStart,
  theirShare: unknown,
  transcript: { fingerprint: string; nodeShare: string; mainShare: string },
): Buffer | null {
  const theirs = readShare(theirShare);
  if (theirs === null) return null;
  const k = modPow(theirs, own.secret, P);
  return createHash('sha256')
    .update(
      `${LABEL} key\0${transcript.fingerprint.toLowerCase()}\0${transcript.nodeShare}\0${transcript.mainShare}\0`,
    )
    .update(toHex(k))
    .digest();
}

/** What each side shows to prove it has the key (never the key itself). */
export const confirmation = (key: Buffer, side: 'node' | 'main'): string =>
  createHmac('sha256', key).update(`${LABEL} ${side}`).digest('hex');

export function sameConfirmation(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/u.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}
