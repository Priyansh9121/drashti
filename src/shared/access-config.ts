/*
 * Where Drashti asks whether it may open (Session 54, E1): the owner's access list, a Google Apps Script
 * web app, and the public half of the key its answers are signed with. Neither is a secret. Both are
 * placeholders until the owner has followed docs/access-setup.md and sent the one line the Sheet's
 * Drashti › Set up… shows (`<address>#key=<public key>`, read by parseSetupLine); then they are put in
 * here for the release, and a release refuses placeholders (accessConfigReal).
 */

/** The web app's address (Deploy › Manage deployments › Web app URL). */
export const ACCESS_LIST_URL = 'https://script.google.com/macros/s/PLACEHOLDER-WEB-APP-ADDRESS/exec';

/** The list's public key: SPKI, base64, RSA 2048 (Drashti › Set up… makes the pair). */
export const ACCESS_LIST_PUBLIC_KEY = 'PLACEHOLDER-PUBLIC-KEY';

/** A web app's address as Apps Script makes one (a Google Workspace account's has /a/macros/<domain>/). */
export const ACCESS_LIST_URL_SHAPE =
  /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]{10,200}\/exec$/u;

/** The start and end of every RSA 2048 public key with the usual exponent, as SPKI in base64. */
const SPKI_START = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA';
const SPKI_END = 'IDAQAB';

/** Whether a public key is in the form Set up… makes (RSA 2048, SPKI, base64). */
export function accessKeyShaped(key: string): boolean {
  return (
    key.length === 392 &&
    key.startsWith(SPKI_START) &&
    key.endsWith(SPKI_END) &&
    /^[A-Za-z0-9+/]+$/u.test(key)
  );
}

/** Whether Drashti has the real list's address and key built in (never a placeholder). */
export function accessConfigReal(
  url: string = ACCESS_LIST_URL,
  key: string = ACCESS_LIST_PUBLIC_KEY,
): boolean {
  return (
    ACCESS_LIST_URL_SHAPE.test(url) && !url.toUpperCase().includes('PLACEHOLDER') && accessKeyShaped(key)
  );
}

/** The one line Drashti › Set up… shows, read: the address and the key, or null when it is not one. */
export function parseSetupLine(line: string): { url: string; publicKey: string } | null {
  const m = /^(\S+)#key=(\S+)$/u.exec(line.trim());
  if (!m?.[1] || !m[2]) return null;
  return accessConfigReal(m[1], m[2]) ? { url: m[1], publicKey: m[2] } : null;
}
