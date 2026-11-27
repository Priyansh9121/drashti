// What a failed packaging leaves on the Release run's page (the third signed dry run, 27 Nov: packaging failed,
// then the job's log was lost when the run was cancelled): electron-builder's last lines in the step summary,
// and the line that says what failed as an error annotation. Both stay when a job's log does not. Colours are
// removed, and the value of every signing secret packaging is given is replaced by ***, although
// electron-builder prints none (GitHub masks them in the log too).

/** The environment variables whose values never appear in the report (scripts/signing-plan.mjs's). */
export const PACKAGING_SECRETS = [
  'MAC_CERT_PASSWORD',
  'CSC_KEY_PASSWORD',
  'WIN_CERT_PASSWORD',
  'WIN_CSC_KEY_PASSWORD',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'MAC_SIGN_P12_PASSWORD',
];

const COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'gu');
const LONGEST = 400;

/** A workflow command's message: % and line ends escaped, as GitHub reads them. */
const escape = (text) => text.replace(/%/gu, '%25').replace(/\r/gu, '%0D').replace(/\n/gu, '%0A');

/**
 * The report for electron-builder's `output` (stdout and stderr as they came) after it exited with `status`.
 * `secrets`: values to hide (4 characters or more; shorter ones would hide ordinary words).
 */
export function failureReport(output, { status, secrets = [], keep = 40 }) {
  const hidden = secrets
    .filter((value) => typeof value === 'string' && value.trim().length >= 4)
    .map((value) => value.trim());
  const lines = String(output)
    .replace(COLOURS, '')
    .split(/\r?\n|\r/u)
    .map((line) => hidden.reduce((text, value) => text.split(value).join('***'), line).trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(-keep)
    .map((line) => (line.length > LONGEST ? `${line.slice(0, LONGEST)}…` : line));
  const last = (test) => [...lines].reverse().find(test);
  // electron-builder marks its errors with ⨯; otherwise the last line that says error or failed.
  const cause =
    last((line) => line.includes('⨯')) ??
    last((line) => /error|failed/iu.test(line)) ??
    lines.at(-1) ??
    'no output';
  return {
    annotation: `::error title=Packaging failed (exit ${String(status)})::${escape(cause.trim())}`,
    summary: `### Packaging failed (exit ${String(status)})\n\nThe last lines electron-builder printed:\n\n\`\`\`\`text\n${lines.join('\n')}\n\`\`\`\`\n`,
  };
}
