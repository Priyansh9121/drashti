import { createPrivateKey, X509Certificate } from 'node:crypto';
import { connect, createServer, type PeerCertificate } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { certificateFingerprint, makeIdentity, pemFingerprint } from './certificate';

/* Main's own certificate for the node link, and a node pinning it. */

/** Connect to a TLS server on this computer trusting only `pinPem`; what it said, or why it was refused. */
function connectPinned(port: number, pinPem: string, pinFingerprint: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(
      {
        host: '127.0.0.1',
        port,
        ca: [pinPem],
        minVersion: 'TLSv1.3',
        checkServerIdentity: (_host: string, cert: PeerCertificate) =>
          certificateFingerprint(cert.raw) === pinFingerprint ? undefined : new Error('not this Main'),
      },
      () => {
        socket.once('data', (data: Buffer) => {
          resolve(`said ${data.toString()}`);
          socket.end();
        });
      },
    );
    socket.on('error', (error: Error) => {
      resolve(`refused: ${error.message}`);
    });
  });
}

describe('Main’s certificate', () => {
  it('is a self-signed X.509 v3 certificate for its own key, valid now and for many years', () => {
    const id = makeIdentity('Placeholder Main', new Date('2026-10-05T10:00:00Z'));
    const cert = new X509Certificate(id.certPem);
    expect(cert.subject).toBe('CN=Placeholder Main');
    expect(cert.issuer).toBe('CN=Placeholder Main');
    expect(cert.ca).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(createPrivateKey(id.keyPem))).toBe(true);
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(new Date('2026-10-05T10:00:00Z').getTime());
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2056);
    expect(id.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(pemFingerprint(id.certPem)).toBe(id.fingerprint);
    expect(id.keyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('serves TLS 1.3; a node pinning it connects, and one pinning another certificate is refused', async () => {
    const main = makeIdentity('Placeholder Main');
    const fake = makeIdentity('Placeholder Main');
    const server = createServer({ key: main.keyPem, cert: main.certPem, minVersion: 'TLSv1.3' }, (s) => {
      s.end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect(await connectPinned(port, main.certPem, main.fingerprint)).toBe('said hello');
      // Another Main with the same name (a fake): refused before anything is said.
      expect(await connectPinned(port, fake.certPem, fake.fingerprint)).toMatch(/^refused/u);
      // The right certificate trusted but the wrong fingerprint expected: refused too.
      expect(await connectPinned(port, main.certPem, fake.fingerprint)).toMatch(/^refused/u);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
