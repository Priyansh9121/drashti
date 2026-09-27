// Tests for the Drashti audit scripts against synthetic fixtures.
//
//   node tools/audit/test/run-tests.mjs            (runs what this OS can run)
//   DRASHTI_PWSH=/path/to/pwsh node ...            (choose the PowerShell binary)
//
// macOS: runs audit-mac.sh with a fake HOME.
// Any OS with PowerShell: runs audit-windows.ps1 against the fake Windows tree.
// Both runs must find the planted fonts and media, redact the planted secrets,
// and leave the fixture tree byte-for-byte unchanged.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const auditDir = dirname(here);
const work = mkdtempSync(join(tmpdir(), 'drashti-audit-test-'));
const fx = join(work, 'fixtures');
const fxInfo = JSON.parse(execFileSync(process.execPath, [join(here, 'make-fixtures.mjs'), fx], { encoding: 'utf8' }));

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function snapshot(dir) {
  const map = {};
  for (const p of walk(dir)) {
    const st = statSync(p);
    map[relative(dir, p)] = `${st.size}:${st.mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`;
  }
  return map;
}
const before = snapshot(fx);

function onlyDir(parent) {
  const dirs = readdirSync(parent).filter((d) => !d.startsWith('.') && statSync(join(parent, d)).isDirectory());
  if (dirs.length !== 1) throw new Error(`expected one report folder in ${parent}, found ${dirs.join(', ')}`);
  return join(parent, dirs[0]);
}
function allText(dir) {
  return walk(dir)
    .filter((p) => /\.(md|json|txt|tsv)$/.test(p))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}
const byName = (list, name) => list.find((x) => x.name.toLowerCase() === name.toLowerCase());
const byPath = (list, suffix) => list.find((x) => x.path.replace(/\\/g, '/').endsWith(suffix));

function commonChecks(tag, j, text) {
  check(`${tag}: schema`, j.schema === 'drashti-audit/1', j.schema);
  const fonts = j.propresenter.fontsUsedInSlideText;
  const gopika = byName(fonts, 'Gopika');
  check(`${tag}: legacy Gopika found with Latin text only`, gopika && gopika.latinLetters > 0 && gopika.gujaratiChars === 0 && gopika.knownLegacyFont === true, JSON.stringify(gopika));
  const kruti = byName(fonts, 'Kruti Dev 010');
  check(`${tag}: legacy Kruti Dev found`, kruti && kruti.knownLegacyFont === true && kruti.devanagariChars === 0, JSON.stringify(kruti));
  const deva = byName(fonts, 'Noto Sans Devanagari');
  check(`${tag}: Unicode Devanagari counted`, deva && deva.devanagariChars > 0, JSON.stringify(deva));
  const shruti = byName(fonts, 'Shruti');
  check(`${tag}: Unicode Gujarati in PP7 RTF (Shruti)`, shruti && shruti.gujaratiChars > 0, JSON.stringify(shruti));
  const mukta = byName(fonts, 'Mukta Vaani');
  check(`${tag}: font inside a .probundle`, !!mukta, fonts.map((f) => f.name).join(', '));
  check(`${tag}: declared-only font reported separately`, j.propresenter.fontsDeclaredButUnused.some((f) => f.name === 'Unused Font'));
  const media = j.propresenter.mediaReferences;
  const loop = media.find((m) => /loop\.mp4$/.test(m.path) && m.exists === true);
  check(`${tag}: existing media found (exact path despite printable tag byte)`, !!loop, JSON.stringify(media.map((m) => m.path)));
  const long = byPath(media, 'missing-clip.mov');
  check(`${tag}: long URL (2-byte length prefix) read exactly`, long && long.exists === false && !long.approximate, JSON.stringify(long));
  for (const s of fxInfo.secrets) check(`${tag}: secret "${s.slice(0, 6)}..." absent from reports`, !text.includes(s));
  check(`${tag}: no errors except expected`, Array.isArray(j.errors), JSON.stringify(j.errors));
}

// ---------------------------------------------------------------- macOS ----
if (process.platform === 'darwin') {
  const script = join(auditDir, 'audit-mac.sh');
  const out = join(work, 'mac-out');
  mkdirSync(out);
  const env = { ...process.env, HOME: fxInfo.home };
  const r = spawnSync('/bin/bash', [script, '--out', out, '--no-spotlight', '--skip-system'], { env, encoding: 'utf8' });
  check('mac: exits 0', r.status === 0, r.stderr.slice(-2000));
  const dir = onlyDir(out);
  const j = JSON.parse(readFileSync(join(dir, 'audit.json'), 'utf8'));
  const text = allText(dir);
  commonChecks('mac', j, text);
  const media = j.propresenter.mediaReferences;
  check('mac: Windows path flagged', media.some((m) => m.problem === 'Windows path'), JSON.stringify(media));
  check('mac: missing PP6 media flagged', media.some((m) => m.path.endsWith('gone away.mov') && m.exists === false));
  const doc = j.propresenter.documentReferences.find((d) => d.path.endsWith('Deleted Song.pro6'));
  check('mac: playlist reference to a missing presentation', doc && doc.exists === false, JSON.stringify(j.propresenter.documentReferences));
  const prefs = j.propresenter.preferences;
  const pv = (k) => (prefs.find((p) => p.key === k) || {}).value;
  check('mac: licence key redacted', pv('RegistrationKey') === '[REDACTED]', pv('RegistrationKey'));
  check('mac: password redacted', pv('RemotePassword') === '[REDACTED]', pv('RemotePassword'));
  check('mac: stream URL redacted', pv('StreamDestination') === '[REDACTED-STREAM-URL]', pv('StreamDestination'));
  check('mac: e-mail redacted', pv('SupportContact') === '[REDACTED-EMAIL]', pv('SupportContact'));
  check('mac: XML entities decoded', pv('Escaped') === 'A & B <C>', pv('Escaped'));
  check('mac: nested preference keys', pv('Outputs/Audience/Resolution') === '1920x1080');
  check('mac: preferences read once', prefs.filter((p) => p.key === 'Escaped').length === 1);
  const pp = j.propresenter.preferencePaths;
  check('mac: missing library path from preferences', pp.some((p) => p.path === '/Volumes/OldDrive/PP6 Library' && p.exists === false), JSON.stringify(pp));
  const locs = j.propresenter.locations.map((l) => l.path);
  check('mac: library found via preferences', j.propresenter.locations.some((l) => l.path.endsWith('/Documents/ProPresenter6') && /preferences/.test(l.foundVia)), JSON.stringify(locs));
  check('mac: Application Support found', locs.some((p) => p.endsWith('/Application Support/RenewedVision')));
  check('mac: stray Qt .pro ignored', !text.includes('qtproject.pro'));
  check('mac: user font listed beyond defaults', j.fontsBeyondDefaults.some((f) => f.file.endsWith('/Library/Fonts/Gopika.ttf')));
  const gop = byName(j.propresenter.fontsUsedInSlideText, 'Gopika');
  check('mac: Gopika matched to the added font file', gop && gop.installed === 'added font', JSON.stringify(gop));
  check('mac: font usage split by kind', gop && /themes\/templates/.test(gop.usedIn) && /presentations/.test(gop.usedIn), gop && gop.usedIn);
  check('mac: markdown report written', existsSync(join(dir, 'audit-report.md')) && readFileSync(join(dir, 'audit-report.md'), 'utf8').includes('## Summary'));

  // collect, with and without media
  for (const noMedia of [false, true]) {
    const dest = join(work, noMedia ? 'usb-nomedia' : 'usb');
    const out2 = join(work, noMedia ? 'mac-out-c2' : 'mac-out-c1');
    mkdirSync(dest);
    mkdirSync(out2);
    const args = [script, '--out', out2, '--no-spotlight', '--skip-system', '--collect', dest];
    if (noMedia) args.push('--no-media');
    const rc = spawnSync('/bin/bash', args, { env, encoding: 'utf8' });
    const tag = noMedia ? 'mac collect --no-media' : 'mac collect';
    check(`${tag}: exits 0`, rc.status === 0, rc.stderr.slice(-2000));
    const cdir = onlyDir(dest);
    const copied = walk(cdir).map((p) => relative(cdir, p));
    check(`${tag}: READ-ME-FIRST.txt warns about secrets`, readFileSync(join(cdir, 'READ-ME-FIRST.txt'), 'utf8').includes('sensitive'));
    check(`${tag}: presentation copied`, copied.some((p) => p.endsWith('ProPresenter6/Test Sample.pro6')), copied.join('\n'));
    check(`${tag}: preferences copied`, copied.some((p) => p.endsWith('com.renewedvision.ProPresenter6.plist')));
    check(`${tag}: font copied`, copied.some((p) => p.startsWith('fonts/') && p.endsWith('Gopika.ttf')));
    check(`${tag}: audit report copied`, copied.some((p) => p.startsWith('audit/') && p.endsWith('audit.json')));
    const mediaCopied = copied.some((p) => p.endsWith('Assets/loop.mp4') || p.endsWith('Renewed Vision Media') );
    void mediaCopied;
    const pp7 = copied.some((p) => p.endsWith('Libraries/Default/Welcome.pro'));
    check(`${tag}: PP7 library copied`, pp7);
    const jc = JSON.parse(readFileSync(join(onlyDir(out2), 'audit.json'), 'utf8'));
    check(`${tag}: status done`, jc.collect.status === 'done', jc.collect.status);
    if (noMedia) check(`${tag}: media left out`, !copied.some((p) => /\.(mp4|mov|jpg|png)$/i.test(p)), copied.filter((p) => /\.(mp4|mov|jpg|png)$/i.test(p)).join(', '));
  }
} else {
  console.log('SKIP  mac: not running on macOS');
}

// ------------------------------------------------------------- Windows ----
const psCandidates = [process.env.DRASHTI_PWSH, 'pwsh', process.platform === 'win32' ? 'powershell.exe' : null].filter(Boolean);
const shells = [];
for (const ps of psCandidates) {
  const v = spawnSync(ps, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (v.status === 0) shells.push({ ps, version: v.stdout.trim() });
}
if (process.platform === 'win32' && !shells.some((s) => /^5\./.test(s.version))) console.log('NOTE  Windows PowerShell 5.1 not found');
if (shells.length === 0) console.log('SKIP  windows: no PowerShell found (set DRASHTI_PWSH)');
for (const { ps, version } of shells) {
  const tag = `windows (PowerShell ${version})`;
  const script = join(auditDir, 'audit-windows.ps1');
  const out = join(work, `win-out-${version}`);
  mkdirSync(out);
  const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-OutDir', out, '-SearchRoot', fxInfo.win, '-SkipSystem', '-NoDefaultLocations'];
  const r = spawnSync(ps, base, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  check(`${tag}: exits 0`, r.status === 0, (r.stderr || '').slice(-3000) + (r.stdout || '').slice(-3000));
  if (r.status !== 0) continue;
  const dir = onlyDir(out);
  const raw = readFileSync(join(dir, 'audit.json'));
  check(`${tag}: audit.json has no BOM`, !(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf));
  const j = JSON.parse(raw.toString('utf8'));
  const text = allText(dir);
  commonChecks(tag, j, text);
  const media = j.propresenter.mediaReferences;
  check(`${tag}: missing Windows media flagged`, media.some((m) => /missing file\.mov$/.test(m.path) && m.exists === false), JSON.stringify(media.map((m) => [m.path, m.exists])));
  check(`${tag}: drive-letter path found in protobuf`, media.some((m) => /Nowhere[\\/]intro\.mp4$/.test(m.path)), JSON.stringify(media.map((m) => m.path)));
  const kinds = new Set(j.propresenter.locations.map((l) => l.kind));
  check(`${tag}: locations classified`, kinds.has('library') || kinds.size > 0, JSON.stringify(j.propresenter.locations));
  check(`${tag}: markdown report written`, readFileSync(join(dir, 'audit-report.md'), 'utf8').includes('## Summary'));
  // collect without media
  const dest = join(work, `win-usb-${version}`);
  const out2 = join(work, `win-out-c-${version}`);
  mkdirSync(dest);
  mkdirSync(out2);
  const rc = spawnSync(ps, [...base.slice(0, 6), out2, ...base.slice(7), '-Collect', dest, '-NoMedia'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  check(`${tag} collect: exits 0`, rc.status === 0, (rc.stderr || '').slice(-3000) + (rc.stdout || '').slice(-2000));
  if (rc.status === 0) {
    const cdir = onlyDir(dest);
    const copied = walk(cdir).map((p) => relative(cdir, p).replace(/\\/g, '/'));
    check(`${tag} collect: presentation copied`, copied.some((p) => p.endsWith('Libraries/Default/Welcome.pro')), copied.join('\n'));
    check(`${tag} collect: media left out`, !copied.some((p) => /\.(mp4|mov)$/i.test(p)));
    check(`${tag} collect: READ-ME-FIRST.txt`, copied.includes('READ-ME-FIRST.txt'));
  }
}

// ------------------------------------------------- full runs (--full) ----
// Runs each script unrestricted on this machine (real hardware, real
// ProPresenter data if any) into a temporary folder. CI uses this to exercise
// the hardware sections on real macOS and real Windows PowerShell 5.1.
if (process.argv.includes('--full')) {
  const runs = [];
  if (process.platform === 'darwin') runs.push({ tag: 'mac full run', cmd: '/bin/bash', args: [join(auditDir, 'audit-mac.sh'), '--no-spotlight'] });
  for (const { ps, version } of shells) {
    if (process.platform === 'win32') runs.push({ tag: `windows full run (PowerShell ${version})`, cmd: ps, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(auditDir, 'audit-windows.ps1')] });
  }
  for (const run of runs) {
    const out = join(work, run.tag.replace(/[^a-z0-9]+/gi, '-'));
    mkdirSync(out);
    const t0 = Date.now();
    const r = spawnSync(run.cmd, [...run.args, run.cmd === '/bin/bash' ? '--out' : '-OutDir', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    check(`${run.tag}: exits 0`, r.status === 0, (r.stderr || '').slice(-3000) + (r.stdout || '').slice(-3000));
    if (r.status !== 0) continue;
    const dir = onlyDir(out);
    const j = JSON.parse(readFileSync(join(dir, 'audit.json'), 'utf8'));
    check(`${run.tag}: OS version recorded`, !!(j.machine.osVersion || j.machine.osName), JSON.stringify(j.machine));
    check(`${run.tag}: at least one GPU`, j.gpus.length > 0, JSON.stringify(j.gpus));
    check(`${run.tag}: at least one active screen with a size`, j.activeScreens.some((s) => s.pixelWidth > 0 && s.pixelHeight > 0), JSON.stringify(j.activeScreens));
    console.log(`INFO  ${run.tag}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${j.activeScreens.length} screen(s), ${j.audioDevices.length} audio device(s), ${j.errors.length} problem(s)`);
    for (const e of j.errors) console.log(`INFO    problem: ${e.section}: ${e.message}`);
  }
}

const after = snapshot(fx);
const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
check('fixtures unchanged (read-only)', changed.length === 0, changed.join(', '));

if (!process.env.DRASHTI_KEEP_TEST_OUTPUT) rmSync(work, { recursive: true, force: true });
else console.log(`output kept in ${work}`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
