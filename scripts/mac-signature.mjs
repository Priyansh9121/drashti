// A Mac build's signature as codesign describes it (QA24-SIGN-1), for scripts/verify-signing.mjs and
// scripts/check-installers.mjs: what signed it (Drashti's own certificate, a Developer ID, or ad hoc) and its
// designated requirement (DR), what macOS's privacy lists keep for an app it was allowed to: Screen Recording,
// the camera and the microphone. Ad hoc code's DR is its own hash (cdhash H"…"), so every build is a new app to
// macOS; one signed with Drashti's own certificate has `identifier "org.drashti.app" and certificate leaf =
// H"<the certificate's SHA-1>"` (`root` instead of `leaf` when the certificate has an Organization: Apple's
// Security source, drmaker.cpp, nonAppleAnchor), the same for every build signed with it.
import { createHash } from 'node:crypto';

/** The name of Drashti's own (self-signed, free) code-signing certificate, as the owner's steps make it. */
export const OWN_IDENTITY = 'Drashti Code Signing';
/** Drashti's id on a Mac (electron-builder.yml's appId). */
export const APP_ID = 'org.drashti.app';

/** The designated requirement in `codesign -d -r-`'s words (its output and standard error together), or null. */
export function designatedRequirement(text) {
  return /^(?:#\s*)?designated\s*=>\s*(.+?)\s*$/mu.exec(text)?.[1] ?? null;
}

/**
 * Whether a designated requirement is Drashti's own certificate's: exactly the id and one certificate's SHA-1,
 * nothing else (no `or`, no cdhash). Its SHA-1 in small letters.
 */
export function ownRequirement(requirement, appId = APP_ID) {
  if (requirement == null) return { ok: false, why: 'codesign printed no designated requirement' };
  if (/^cdhash\b/u.test(requirement))
    return { ok: false, why: `it is the build’s own hash (cdhash, as ad hoc): ${requirement}` };
  const m = /^identifier "([^"]+)" and certificate (leaf|root) = H"([0-9a-fA-F]{40})"$/u.exec(requirement);
  if (!m)
    return {
      ok: false,
      why: `it is not the form of Drashti’s own certificate (identifier "${appId}" and certificate leaf = H"<SHA-1>"): ${requirement}`,
    };
  if (m[1] !== appId) return { ok: false, why: `it names the id ${m[1] ?? ''}, not ${appId}` };
  return { ok: true, sha1: (m[3] ?? '').toLowerCase(), slot: m[2] === 'root' ? 'root' : 'leaf' };
}

/** What signed a program, from `codesign -dvv`'s words: Drashti's own certificate, ad hoc, a Developer ID, or other. */
export function signedBy(text) {
  if (/^Signature=adhoc$/mu.test(text)) return 'ad-hoc';
  if (/^Authority=Developer ID Application: /mu.test(text)) return 'developer-id';
  // The first Authority is the signing certificate; a certificate of one's own has no other.
  if (/^Authority=(.*)$/mu.exec(text)?.[1] === OWN_IDENTITY) return 'own';
  return 'other';
}

/** A certificate's SHA-1 as a designated requirement gives it: of its DER bytes, in small letters. */
export function certificateSha1(der) {
  return createHash('sha1').update(der).digest('hex');
}

/** The job summary's lines for a build signed with Drashti's own certificate (a certificate's hash is public). */
export function ownSummary(builds) {
  const sha1s = [...new Set(builds.map((b) => b.sha1))];
  return [
    '### Mac signature: Drashti’s own certificate',
    '',
    `Signed with \`${OWN_IDENTITY}\` (free, self-signed). Not notarised: that needs a paid Developer ID.`,
    '',
    `Certificate SHA-1: ${sha1s.map((s) => `\`${s}\``).join(', ')} (public; the same in every build signed with it)`,
    '',
    'Designated requirement (what macOS keeps for a permission):',
    ...builds.map((b) => `- ${b.dir}: \`${b.requirement}\``),
    '',
  ].join('\n');
}
