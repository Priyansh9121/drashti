// How scripts/package-release.mjs has electron-builder sign (Session 14; moved here unchanged for its tests,
// QA24-SIGN-1): signed and notarised when the certificates are given as CI secrets, and left unsigned, cleanly,
// when they are not (a Mac's signed ad hoc). A secret is only ever written to a file through writeSecret (the
// runner's temporary folder, removed afterwards) or passed in the environment to electron-builder; nothing here
// prints one, only whether signing is on.
//
//   macOS:   MAC_CERT_P12 (base64 of the Developer ID Application .p12) and MAC_CERT_PASSWORD;
//            notarised too with APPLE_API_KEY_P8 (the App Store Connect key's text), APPLE_API_KEY_ID
//            and APPLE_API_ISSUER.
//   Windows: WIN_CERT_PFX (base64 of a .pfx) and WIN_CERT_PASSWORD; or Azure Trusted Signing with
//            AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_SIGNING_ENDPOINT,
//            AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE and AZURE_PUBLISHER_NAME.
//
// QA24-SIGN-1, a Mac's third way: Drashti's own certificate (free, self-signed, named "Drashti Code Signing"),
// imported by the Release workflow into a temporary keychain (scripts/mac-sign-keychain.mjs), whose path alone
// comes here as MAC_SIGN_KEYCHAIN; the certificate and its password never do. A Developer ID wins over it.

const SIGNING_VARS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
];
// Drashti's own certificate's keychain (QA24-SIGN-1): only its branch below gives electron-builder one.
const OWN_VARS = ['MAC_SIGN_KEYCHAIN', 'CSC_KEYCHAIN'];
/** The name of Drashti's own certificate, as the owner's steps make it (scripts/mac-signature.mjs). */
const OWN_IDENTITY = 'Drashti Code Signing';

/**
 * electron-builder's environment and extra arguments for this computer, and what release-signing.json records.
 * `given` is the environment the script was started with; `writeSecret(name, data)` keeps a secret in a file and
 * returns its path.
 */
export function signingPlan({ platform, given, writeSecret }) {
  const env = { ...given };
  const has = (name) => typeof given[name] === 'string' && given[name].trim() !== '';
  // Start from nothing: only what is set below can turn signing on.
  for (const name of [...SIGNING_VARS, ...OWN_VARS]) delete env[name];
  const extra = [];
  let signed = false;
  let notarised = false;
  let how = 'unsigned (no certificate given)';
  let own = false;

  if (platform === 'darwin' && has('MAC_CERT_P12')) {
    env.CSC_LINK = writeSecret('developer-id.p12', Buffer.from(given.MAC_CERT_P12.trim(), 'base64'));
    env.CSC_KEY_PASSWORD = given.MAC_CERT_PASSWORD ?? '';
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
    signed = true;
    how = 'signed with a Developer ID';
    if (has('APPLE_API_KEY_P8') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER')) {
      env.APPLE_API_KEY = writeSecret('app-store-connect.p8', given.APPLE_API_KEY_P8.trim() + '\n');
      env.APPLE_API_KEY_ID = given.APPLE_API_KEY_ID.trim();
      env.APPLE_API_ISSUER = given.APPLE_API_ISSUER.trim();
      notarised = true;
      how += ', and notarised';
    } else how += ', not notarised (no App Store Connect key given)';
  } else if (platform === 'darwin' && has('MAC_SIGN_KEYCHAIN')) {
    // Drashti's own certificate (QA24-SIGN-1), found by its name in the keychain the workflow made, and only
    // there (electron-builder's CSC_KEYCHAIN). Never notarised: notarisation needs a paid Developer ID. Without the
    // hardened runtime, as ad hoc: its library validation lets a program load only libraries signed by Apple or
    // with its own Team ID, and a certificate of one's own has no Team ID ("mapped file has no Team ID and is not
    // a platform binary"), so Drashti would not start; macOS's permissions do not need it. The entitlements are
    // electron-builder.yml's, as for every build. forceCodeSigning: if the identity is not found, electron-builder
    // fails, where it would otherwise leave the app unsigned with a warning.
    env.CSC_KEYCHAIN = given.MAC_SIGN_KEYCHAIN.trim();
    extra.push(
      `-c.mac.identity=${OWN_IDENTITY}`,
      '-c.mac.hardenedRuntime=false',
      '-c.mac.notarize=false',
      '-c.forceCodeSigning=true',
    );
    signed = true;
    own = true;
    how = "signed with Drashti's own certificate, not notarised (it is not a Developer ID)";
  } else if (platform === 'win32' && has('WIN_CERT_PFX')) {
    env.WIN_CSC_LINK = writeSecret('code-signing.pfx', Buffer.from(given.WIN_CERT_PFX.trim(), 'base64'));
    env.WIN_CSC_KEY_PASSWORD = given.WIN_CERT_PASSWORD ?? '';
    signed = true;
    how = 'signed with a code-signing certificate';
  } else if (
    platform === 'win32' &&
    ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'].every(has) &&
    [
      'AZURE_SIGNING_ENDPOINT',
      'AZURE_SIGNING_ACCOUNT',
      'AZURE_SIGNING_PROFILE',
      'AZURE_PUBLISHER_NAME',
    ].every(has)
  ) {
    // The account, profile and publisher are names, not secrets; the credentials stay in the environment.
    extra.push(
      `-c.win.azureSignOptions.endpoint=${given.AZURE_SIGNING_ENDPOINT.trim()}`,
      `-c.win.azureSignOptions.codeSigningAccountName=${given.AZURE_SIGNING_ACCOUNT.trim()}`,
      `-c.win.azureSignOptions.certificateProfileName=${given.AZURE_SIGNING_PROFILE.trim()}`,
      `-c.win.azureSignOptions.publisherName=${given.AZURE_PUBLISHER_NAME.trim()}`,
    );
    signed = true;
    how = 'signed with Azure Trusted Signing';
  }
  if (!signed) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  // No certificate on a Mac (Session 18): signed ad hoc all through, so that a downloaded copy is one macOS
  // "could not verify" (opened once with Open Anyway in System Settings, Privacy & Security), not one it
  // calls "damaged" (an app whose own signature does not cover it, as electron-builder leaves an unsigned
  // one: there is no Open Anyway for that). Without the hardened runtime, which only notarisation needs
  // and whose library validation stops an app signed ad hoc from starting.
  if (!signed && platform === 'darwin') {
    extra.push('-c.mac.identity=-', '-c.mac.hardenedRuntime=false');
    how = 'signed ad hoc (no certificate given)';
  }
  return { env, extra, how, record: { platform, signed, notarised, ...(own ? { kind: 'own' } : {}) } };
}
