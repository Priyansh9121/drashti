// Run end-to-end specs while watching which app is in front, to show that the
// quiet test mode (src/main/windows/quiet.ts) never takes over the screen.
// macOS only. Every half second it asks `lsappinfo front` for the frontmost
// app, and `lsappinfo` how each running Electron app is set to run ("UIElement"
// is an accessory app: no Dock icon, no menu bar). It fails if Drashti or
// Electron ever came to the front.
//
//   node scripts/quiet-check.mjs tests/e2e/network.spec.ts    one spec, quietly (pnpm build first)
//   node scripts/quiet-check.mjs --expect-front <spec>       the control run, with DRASHTI_E2E_LOUD=1:
//                                                           Drashti must be seen in front, or the
//                                                           check could not see it at all
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.platform !== 'darwin') {
  console.log('quiet-check: macOS only (it asks lsappinfo which app is in front).');
  process.exit(0);
}

const args = process.argv.slice(2);
const expectFront = args.includes('--expect-front');
const specs = args.filter((a) => a !== '--expect-front');
const EVERY_MS = 500;
const DRASHTI = /electron|drashti/iu;

const lsappinfo = (...a) => spawnSync('lsappinfo', a, { encoding: 'utf8' }).stdout ?? '';
const field = (text, name) => new RegExp(`"${name}"="([^"]*)"`, 'u').exec(text)?.[1] ?? '?';

/** The frontmost app: its name and bundle id. */
function frontApp() {
  const asn = lsappinfo('front').trim();
  if (!asn.startsWith('ASN:')) return null;
  const info = lsappinfo('info', '-only', 'name', '-only', 'bundleid', asn);
  return { name: field(info, 'LSDisplayName'), id: field(info, 'CFBundleIdentifier') };
}

/** How each running Electron app is set to run (Foreground, UIElement...). */
function electronTypes() {
  const found = lsappinfo('find', 'bundleid=com.github.Electron');
  return [...found.matchAll(/ASN:(0x[0-9a-f]+-0x[0-9a-f]+)/giu)].map((m) =>
    field(lsappinfo('info', '-only', 'applicationtype', `ASN:${m[1]}:`), 'ApplicationType'),
  );
}

const fronts = new Map();
const types = new Map();
let polls = 0;
let drashtiFront = 0;
const started = Date.now();
const poll = () => {
  polls += 1;
  const app = frontApp();
  const label = app ? `${app.name} (${app.id})` : 'none';
  fronts.set(label, (fronts.get(label) ?? 0) + 1);
  if (app && (DRASHTI.test(app.name) || DRASHTI.test(app.id))) {
    drashtiFront += 1;
    if (drashtiFront === 1)
      console.log(
        `quiet-check: ${label} came to the front ${((Date.now() - started) / 1000).toFixed(1)} s in`,
      );
  }
  for (const t of electronTypes()) types.set(t, (types.get(t) ?? 0) + 1);
};

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawn(process.execPath, [cli, 'test', ...specs, '--reporter=list'], { stdio: 'inherit', env });
poll();
const timer = setInterval(poll, EVERY_MS);
run.on('exit', (code) => {
  clearInterval(timer);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nquiet-check: the front app, asked ${polls} times over ${seconds} s (every ${EVERY_MS} ms):`);
  for (const [label, n] of fronts) console.log(`  ${label}: ${n}`);
  const typeText = [...types].map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`quiet-check: how Electron ran when asked: ${typeText || 'not seen running'}`);
  let failed = code !== 0;
  if (expectFront) {
    console.log(
      drashtiFront > 0
        ? `quiet-check: control run: Drashti was seen in front ${drashtiFront} times, so the check can see it.`
        : 'quiet-check: control run: Drashti was never seen in front, so this check proves nothing here.',
    );
    if (drashtiFront === 0) failed = true;
  } else if (drashtiFront > 0) {
    console.log(`quiet-check: FAILED: Drashti or Electron was the front app ${drashtiFront} times.`);
    failed = true;
  } else {
    console.log('quiet-check: Drashti and Electron never came to the front.');
  }
  if (code !== 0) console.log(`quiet-check: the tests themselves failed (exit ${code}).`);
  process.exit(failed ? 1 : 0);
});
