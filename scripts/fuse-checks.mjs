// Electron's fuses in a packaged Drashti (Sessions 31–36, REL-7), and the proof that it no longer runs as
// Node. Used by scripts/check-installers.mjs on each installed app, and by its unit test
// (src/main/release-checks/fuse-checks.test.ts) on the Electron the repository builds with.
import { spawn } from 'node:child_process';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

/** The fuses a packaged Drashti must have: [fuse, state (48 off, 49 on), what it is]. */
export const FUSES = [
  [FuseV1Options.RunAsNode, 48, 'running as Node (ELECTRON_RUN_AS_NODE)'],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, 48, 'NODE_OPTIONS'],
  [FuseV1Options.EnableNodeCliInspectArguments, 48, '--inspect and its kind'],
  [
    FuseV1Options.GrantFileProtocolExtraPrivileges,
    49,
    "file:// pages' privileges (Drashti's pages are file://)",
  ],
];

/**
 * Whether `electron`'s fuses are as a packaged Drashti's must be: a Mac's .app, Windows' .exe, or the
 * file that holds them. { ok, why }.
 */
export async function fusesAsWanted(electron) {
  let wire;
  try {
    wire = await getCurrentFuseWire(electron);
  } catch (error) {
    return { ok: false, why: `its fuses could not be read (${String(error?.message ?? error)})` };
  }
  const wrong = FUSES.filter(([fuse, want]) => wire[fuse] !== want).map(
    ([, want, what]) => `${what} is ${want === 48 ? 'still on' : 'off'}`,
  );
  return wrong.length > 0
    ? { ok: false, why: `its fuses: ${wrong.join('; ')}` }
    : {
        ok: true,
        why: "its fuses: running as Node, NODE_OPTIONS and --inspect off; file:// pages' privileges kept",
      };
}

/**
 * Start `command` with ELECTRON_RUN_AS_NODE=1 (and the rest of `env`) and a script to run: ok when it
 * started as Drashti and its self-test said so, not when the script ran. { ok, why }.
 */
export function runAsNodeRefused(command, args, env, limitMs) {
  // The marker is put together by the script, so a command line echoed back never looks like it ran.
  const script = "process.stdout.write(['DRASHTI', 'RAN', 'AS', 'NODE'].join('_') + '\\n')";
  return new Promise((done) => {
    const child = spawn(command, [...args, '-e', script], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d.toString()));
    child.stderr.on('data', (d) => (log += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), limitMs);
    child.on('exit', () => {
      clearTimeout(timer);
      if (log.includes('DRASHTI_RAN_AS_NODE'))
        done({ ok: false, why: 'ELECTRON_RUN_AS_NODE=1 still runs it as Node: the script ran' });
      else if (log.includes('DRASHTI_SELFTEST_RESULT '))
        done({
          ok: true,
          why: 'with ELECTRON_RUN_AS_NODE=1 it starts as Drashti, never as Node: no script ran',
        });
      else
        done({
          ok: false,
          why: `with ELECTRON_RUN_AS_NODE=1 it neither ran the script nor started\n${log.slice(-1500)}`,
        });
    });
  });
}
