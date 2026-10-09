import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { der, makeIdentity, toPem } from '../../nodes/certificate';

/*
 * Tests only: a made-up certificate authority, and a certificate it signed
 * for a server on 127.0.0.1, so a test can check how FFmpeg treats a stream
 * server's certificate without reaching the internet (Session 23). Nothing
 * here is trusted by any computer: a client trusts it only when it is given
 * the authority's own file.
 */

export interface MadeUpAuthority {
  /** The authority's certificate (what a client is given to trust it). */
  caPem: string;
  /** The server's certificate (for the address 127.0.0.1), signed by the authority. */
  certPem: string;
  keyPem: string;
}

const AUTHORITY_NAME = 'Drashti test authority (made up)';
const COMMON_NAME = '2.5.4.3';
const ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const BASIC_CONSTRAINTS = '2.5.29.19';
const KEY_USAGE = '2.5.29.15';
const EXTENDED_KEY_USAGE = '2.5.29.37';
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const SUBJECT_ALT_NAME = '2.5.29.17';

const name = (text: string) => der.sequence(der.set(der.sequence(der.oid(COMMON_NAME), der.utf8(text))));

export function makeAuthority(now = new Date()): MadeUpAuthority {
  const authority = makeIdentity(AUTHORITY_NAME, now);
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const algorithm = der.sequence(der.oid(ECDSA_WITH_SHA256));
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const extensions = der.explicit(
    3,
    der.sequence(
      // Not an authority itself.
      der.sequence(der.oid(BASIC_CONSTRAINTS), der.bool(true), der.octets(der.sequence())),
      // Signing (the TLS handshake) only.
      der.sequence(der.oid(KEY_USAGE), der.bool(true), der.octets(der.bits(Buffer.from([0x80]), 7))),
      der.sequence(der.oid(EXTENDED_KEY_USAGE), der.octets(der.sequence(der.oid(SERVER_AUTH)))),
      // The address it serves: 127.0.0.1.
      der.sequence(
        der.oid(SUBJECT_ALT_NAME),
        der.octets(der.sequence(der.tlv(0x87, Buffer.from([127, 0, 0, 1])))),
      ),
    ),
  );
  const tbs = der.sequence(
    der.explicit(0, der.integer(Buffer.from([2]))),
    der.integer(serial),
    algorithm,
    name(AUTHORITY_NAME),
    der.sequence(
      der.time(new Date(now.getTime() - 3600_000)),
      der.time(new Date(now.getTime() + 86_400_000)),
    ),
    name('127.0.0.1'),
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, authority.keyPem);
  return {
    caPem: authority.certPem,
    certPem: toPem(der.sequence(tbs, algorithm, der.bits(signature))),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
