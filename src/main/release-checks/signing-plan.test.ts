import { describe, expect, it } from 'vitest';
import { signingPlan } from '../../../scripts/signing-plan.mjs';

/*
 * How the Release workflow's packaging signs (scripts/package-release.mjs through scripts/signing-plan.mjs):
 * a Developer ID or a Windows certificate when given, otherwise a Mac's ad hoc signature and an unsigned
 * Windows build. Placeholder values only: nothing here is a real certificate or password.
 */

const written: string[] = [];
const writeSecret = (name: string) => {
  written.push(name);
  return `/runner-temp/drashti-signing-x/${name}`;
};
const plan = (platform: string, given: Record<string, string>) => {
  written.length = 0;
  return signingPlan({ platform, given, writeSecret });
};
const AD_HOC = ['-c.mac.identity=-', '-c.mac.hardenedRuntime=false'];

describe('the release’s signing plan', () => {
  it('signs a Mac ad hoc when no certificate is given, as since Session 18', () => {
    const p = plan('darwin', { PATH: '/usr/bin' });
    expect(p.extra).toEqual(AD_HOC);
    expect(p.how).toBe('signed ad hoc (no certificate given)');
    expect(p.env).toEqual({ PATH: '/usr/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
    expect(`${JSON.stringify(p.record)}\n`).toBe('{"platform":"darwin","signed":false,"notarised":false}\n');
    expect(written).toEqual([]);
  });

  it('never passes on a signing variable it did not set', () => {
    const p = plan('darwin', { CSC_LINK: 'placeholder', CSC_KEY_PASSWORD: 'x', APPLE_ID: 'y' });
    expect(p.extra).toEqual(AD_HOC);
    expect(p.env).toEqual({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  });

  it('signs with a Developer ID, and notarises with an App Store Connect key, when given', () => {
    const p = plan('darwin', {
      MAC_CERT_P12: Buffer.from('placeholder').toString('base64'),
      MAC_CERT_PASSWORD: 'placeholder',
      APPLE_API_KEY_P8: 'placeholder',
      APPLE_API_KEY_ID: 'KEYID',
      APPLE_API_ISSUER: 'ISSUER',
    });
    expect(p.extra).toEqual([]);
    expect(p.env['CSC_LINK']).toBe('/runner-temp/drashti-signing-x/developer-id.p12');
    expect(p.env['CSC_KEY_PASSWORD']).toBe('placeholder');
    expect(p.env['CSC_IDENTITY_AUTO_DISCOVERY']).toBe('true');
    expect(p.env['APPLE_API_KEY']).toBe('/runner-temp/drashti-signing-x/app-store-connect.p8');
    expect(p.how).toBe('signed with a Developer ID, and notarised');
    expect(p.record).toEqual({ platform: 'darwin', signed: true, notarised: true });
    expect(written).toEqual(['developer-id.p12', 'app-store-connect.p8']);
  });

  it('leaves Windows unsigned with no certificate, and signs it with one', () => {
    const none = plan('win32', {});
    expect(none.extra).toEqual([]);
    expect(none.how).toBe('unsigned (no certificate given)');
    expect(none.record).toEqual({ platform: 'win32', signed: false, notarised: false });
    const pfx = plan('win32', { WIN_CERT_PFX: 'cGxhY2Vob2xkZXI=', WIN_CERT_PASSWORD: 'placeholder' });
    expect(pfx.env['WIN_CSC_LINK']).toBe('/runner-temp/drashti-signing-x/code-signing.pfx');
    expect(pfx.how).toBe('signed with a code-signing certificate');
  });

  // QA24-SIGN-1: the Release workflow's Mac job imports Drashti's own certificate (scripts/mac-sign-keychain.mjs)
  // into a temporary keychain and gives its path as MAC_SIGN_KEYCHAIN; never the certificate itself.
  const KEYCHAIN = '/runner-temp/drashti-mac-sign/signing.keychain-db';

  it('signs a Mac with Drashti’s own certificate from that keychain: no hardened runtime, never notarised', () => {
    const p = plan('darwin', {
      MAC_SIGN_KEYCHAIN: KEYCHAIN,
      APPLE_API_KEY_P8: 'placeholder',
      APPLE_API_KEY_ID: 'KEYID',
      APPLE_API_ISSUER: 'ISSUER',
    });
    expect(p.extra).toEqual([
      '-c.mac.identity=Drashti Code Signing',
      '-c.mac.hardenedRuntime=false',
      '-c.mac.notarize=false',
      '-c.forceCodeSigning=true',
    ]);
    expect(p.env['CSC_KEYCHAIN']).toBe(KEYCHAIN);
    for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'MAC_SIGN_KEYCHAIN'])
      expect(p.env[name], name).toBeUndefined();
    expect(p.how).toBe("signed with Drashti's own certificate, not notarised (it is not a Developer ID)");
    expect(p.record).toEqual({ platform: 'darwin', signed: true, notarised: false, kind: 'own' });
    expect(written).toEqual([]);
  });

  it('lets a Developer ID win when both are given', () => {
    const p = plan('darwin', {
      MAC_CERT_P12: Buffer.from('placeholder').toString('base64'),
      MAC_CERT_PASSWORD: 'placeholder',
      MAC_SIGN_KEYCHAIN: KEYCHAIN,
    });
    expect(p.how).toBe('signed with a Developer ID, not notarised (no App Store Connect key given)');
    expect(p.extra).toEqual([]);
    expect(p.env['CSC_KEYCHAIN']).toBeUndefined();
    expect(p.record).toEqual({ platform: 'darwin', signed: true, notarised: false });
  });

  it('signs ad hoc exactly as before when the keychain is empty (no certificate of its own was imported)', () => {
    const before = plan('darwin', { PATH: '/usr/bin' });
    const empty = plan('darwin', { PATH: '/usr/bin', MAC_SIGN_KEYCHAIN: '' });
    expect(empty).toEqual(before);
    expect(empty.extra).toEqual(AD_HOC);
    expect(`${JSON.stringify(empty.record)}\n`).toBe(
      '{"platform":"darwin","signed":false,"notarised":false}\n',
    );
  });

  it('never takes the keychain on Windows', () => {
    const p = plan('win32', { MAC_SIGN_KEYCHAIN: KEYCHAIN });
    expect(p).toEqual(plan('win32', {}));
  });
});
