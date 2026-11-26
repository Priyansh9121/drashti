import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  certificateSha1,
  designatedRequirement,
  OWN_IDENTITY,
  ownRequirement,
  ownSummary,
  signedBy,
} from '../../../scripts/mac-signature.mjs';

/*
 * QA24-SIGN-1: a Mac build signed with Drashti's own certificate (a free, self-signed one named
 * "Drashti Code Signing") must carry a designated requirement that names Drashti's id and that certificate,
 * never the build's own hash (cdhash, what ad hoc gives), so macOS keeps its permissions across updates.
 * scripts/verify-signing.mjs reads codesign's words with these; the samples below are codesign's output as it
 * prints it, with placeholder hashes.
 */

const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const EXE =
  'Executable=/Users/runner/work/drashti/drashti/release/1.0.0-alpha.24/mac-arm64/Drashti.app/Contents/MacOS/Drashti';

/** `codesign -d -r- Drashti.app`, its standard error (Executable=) and output together. */
const requirementOf = (line: string) => `${EXE}\n${line}\n`;
const OWN_LEAF = requirementOf(
  `# designated => identifier "org.drashti.app" and certificate leaf = H"${SHA1}"`,
);
const OWN_ROOT = requirementOf(
  `# designated => identifier "org.drashti.app" and certificate root = H"${SHA1.toUpperCase()}"`,
);
const AD_HOC = requirementOf(`# designated => cdhash H"${'f'.repeat(40)}"`);
const DEVELOPER_ID = requirementOf(
  'designated => anchor apple generic and identifier "org.drashti.app" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = PLACEHOLD1)',
);

/** `codesign -dvv Drashti.app`'s words (standard error), for each kind of signature. */
const dvv = (lines: string[]) =>
  [
    EXE,
    'Identifier=org.drashti.app',
    'Format=app bundle with Mach-O thin (arm64)',
    ...lines,
    'Info.plist entries=31',
    'Sealed Resources version=2 rules=13 files=412',
  ].join('\n');
const DVV_OWN = dvv([
  'CodeDirectory v=20500 size=1300 flags=0x0(none) hashes=29+7 location=embedded',
  'Signature size=1712',
  'Authority=Drashti Code Signing',
  'Timestamp=27 Nov 2026 at 05:00:00',
  'TeamIdentifier=not set',
  'Internal requirements count=1 size=104',
]);
const DVV_AD_HOC = dvv([
  'CodeDirectory v=20400 size=1300 flags=0x2(adhoc) hashes=29+7 location=embedded',
  'Signature=adhoc',
  'TeamIdentifier=not set',
  'Internal requirements count=0 size=12',
]);
const DVV_DEVELOPER_ID = dvv([
  'CodeDirectory v=20500 size=1300 flags=0x10000(runtime) hashes=29+7 location=embedded',
  'Signature size=9000',
  'Authority=Developer ID Application: Placeholder (PLACEHOLD1)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=PLACEHOLD1',
]);

describe('Drashti’s own certificate in a Mac build’s signature (QA24-SIGN-1)', () => {
  it('names the identity and the id the owner’s steps use', () => {
    expect(OWN_IDENTITY).toBe('Drashti Code Signing');
    expect(APP_ID).toBe('org.drashti.app');
  });

  it('reads the designated requirement from codesign’s words, with or without its #', () => {
    expect(designatedRequirement(OWN_LEAF)).toBe(
      `identifier "org.drashti.app" and certificate leaf = H"${SHA1}"`,
    );
    expect(designatedRequirement(DEVELOPER_ID)).toMatch(/^anchor apple generic and identifier/u);
    expect(designatedRequirement(`${EXE}\n`)).toBeNull();
    expect(designatedRequirement('')).toBeNull();
  });

  it('takes the id and the certificate’s SHA-1 (leaf, or root for a certificate with an Organization)', () => {
    expect(ownRequirement(designatedRequirement(OWN_LEAF))).toEqual({
      ok: true,
      sha1: SHA1,
      slot: 'leaf',
    });
    // The same certificate, its hash as codesign may print it (capitals); kept in small letters.
    expect(ownRequirement(designatedRequirement(OWN_ROOT))).toEqual({
      ok: true,
      sha1: SHA1,
      slot: 'root',
    });
  });

  it('refuses the build’s own hash (ad hoc), a Developer ID’s, another id and anything more', () => {
    const adHoc = ownRequirement(designatedRequirement(AD_HOC));
    expect(adHoc.ok).toBe(false);
    expect(adHoc.why).toMatch(/the build’s own hash \(cdhash, as ad hoc\)/u);
    expect(ownRequirement(designatedRequirement(DEVELOPER_ID)).ok).toBe(false);
    const other = ownRequirement(`identifier "org.example.other" and certificate leaf = H"${SHA1}"`);
    expect(other).toEqual({
      ok: false,
      why: 'it names the id org.example.other, not org.drashti.app',
    });
    for (const bad of [
      `identifier "org.drashti.app" and certificate leaf = H"${SHA1}" or cdhash H"${SHA1}"`,
      `identifier "org.drashti.app" or certificate leaf = H"${SHA1}"`,
      `identifier "org.drashti.app" and certificate 1 = H"${SHA1}"`,
      `identifier "org.drashti.app" and certificate leaf = H"${SHA1.slice(1)}"`,
      'identifier "org.drashti.app"',
    ])
      expect(ownRequirement(bad).ok, bad).toBe(false);
    expect(ownRequirement(null)).toEqual({
      ok: false,
      why: 'codesign printed no designated requirement',
    });
  });

  it('tells Drashti’s own certificate from ad hoc and a Developer ID in codesign -dvv’s words', () => {
    expect(signedBy(DVV_OWN)).toBe('own');
    expect(signedBy(DVV_AD_HOC)).toBe('ad-hoc');
    expect(signedBy(DVV_DEVELOPER_ID)).toBe('developer-id');
    // Another certificate of one's own is not Drashti's, and an unsigned program is nothing.
    expect(signedBy(DVV_OWN.replace('Authority=Drashti Code Signing', 'Authority=Someone Else'))).toBe(
      'other',
    );
    expect(signedBy(`${EXE}\nDrashti.app: code object is not signed at all`)).toBe('other');
  });

  it('hashes a certificate as codesign’s requirement does: the SHA-1 of its DER bytes, in small letters', () => {
    const der = Buffer.from('placeholder certificate bytes');
    expect(certificateSha1(der)).toBe(createHash('sha1').update(der).digest('hex'));
    expect(certificateSha1(der)).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('writes the certificate’s SHA-1 and the requirement to the job summary, to compare two builds', () => {
    const requirement = `identifier "org.drashti.app" and certificate leaf = H"${SHA1}"`;
    const summary = ownSummary([
      { dir: 'mac-arm64', sha1: SHA1, requirement },
      { dir: 'mac', sha1: SHA1, requirement },
    ]);
    expect(summary).toContain('### Mac signature: Drashti’s own certificate');
    expect(summary).toContain(`Certificate SHA-1: \`${SHA1}\``);
    expect(summary).toContain(`- mac-arm64: \`${requirement}\``);
    expect(summary).toContain(`- mac: \`${requirement}\``);
    expect(summary).toContain('Not notarised');
    expect(summary.endsWith('\n')).toBe(true);
  });
});
