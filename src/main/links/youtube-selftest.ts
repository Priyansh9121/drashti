import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DENO_AS_YT_DLP_RUNS_IT, toolEnv, toolFolders, type YoutubeTools } from './youtube-tools';

/*
 * Part of DRASHTI_SELFTEST=ffmpeg (scripts/check-ffmpeg.mjs, on every built
 * and packaged app in CI, the Intel Mac one under Rosetta): Drashti finds and
 * runs its own yt-dlp and Deno (--version only: nothing is downloaded, and
 * nothing on the internet is asked), and Deno, started exactly as yt-dlp
 * starts it and with the same environment, cannot read a file, reach
 * 127.0.0.1 or start a program.
 */

/** The error names Deno gives a refused permission (NotCapable since Deno 2; PermissionDenied before). */
const REFUSED = new Set(['NotCapable', 'PermissionDenied']);

export interface YoutubeSelfTestResult {
  passed: boolean;
  ytDlp: { path: string | null; version: string | null };
  deno: { path: string | null; version: string | null };
  /** What each attempt by Deno met (refused: NotCapable), and how many connections the local server saw. */
  sandbox: { readFile: string; network: string; runProgram: string; connections: number } | null;
}

const TIMEOUT_MS = 90_000;

function run(
  path: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
  stdin?: string,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(path, args, { env, cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdin.end(stdin ?? '');
  });
}

const firstLine = (text: string): string | null => {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line === '' ? null : line;
};

export async function youtubeSelfTest(
  tools: YoutubeTools | null,
  platform: NodeJS.Platform,
): Promise<YoutubeSelfTestResult> {
  if (!tools)
    return {
      passed: false,
      ytDlp: { path: null, version: null },
      deno: { path: null, version: null },
      sandbox: null,
    };
  const work = mkdtempSync(join(tmpdir(), 'drashti-youtube-check-'));
  const folders = toolFolders(work);
  for (const dir of [folders.home, folders.temp, folders.deno]) mkdirSync(dir, { recursive: true });
  const env = toolEnv(folders, platform);
  let connections = 0;
  const server = createServer((_req, res) => {
    res.end('reached');
  });
  server.on('connection', () => {
    connections++;
  });
  try {
    const yt = await run(tools.ytDlp, ['--ignore-config', '--no-update', '--version'], env, work);
    const ytVersion = yt.code === 0 ? firstLine(yt.out) : null;
    const dn = await run(tools.deno, ['--version'], env, work);
    const denoVersion = dn.code === 0 ? firstLine(dn.out) : null;

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const file = join(work, 'placeholder.txt');
    writeFileSync(file, 'placeholder');
    const script = [
      'const out = {};',
      `try { Deno.readTextFileSync(${JSON.stringify(file)}); out.readFile = 'read'; } catch (e) { out.readFile = e.name; }`,
      `try { await fetch(${JSON.stringify(`http://127.0.0.1:${String(port)}/`)}); out.network = 'reached'; } catch (e) { out.network = e.name; }`,
      `try { new Deno.Command(${JSON.stringify(tools.deno)}, { args: ['--version'] }).outputSync(); out.runProgram = 'started'; } catch (e) { out.runProgram = e.name; }`,
      'console.log(JSON.stringify(out));',
    ].join('\n');
    const probe = await run(tools.deno, DENO_AS_YT_DLP_RUNS_IT, env, work, script);
    const line = probe.out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop();
    let sandbox: YoutubeSelfTestResult['sandbox'] = null;
    try {
      const said = JSON.parse(line ?? '') as Record<string, unknown>;
      const name = (key: string) => (typeof said[key] === 'string' ? said[key] : 'nothing');
      sandbox = {
        readFile: name('readFile'),
        network: name('network'),
        runProgram: name('runProgram'),
        connections,
      };
    } catch {
      sandbox = null;
    }
    const refused =
      sandbox !== null &&
      REFUSED.has(sandbox.readFile) &&
      REFUSED.has(sandbox.network) &&
      REFUSED.has(sandbox.runProgram) &&
      sandbox.connections === 0;
    return {
      passed: ytVersion !== null && denoVersion !== null && refused,
      ytDlp: { path: tools.ytDlp, version: ytVersion },
      deno: { path: tools.deno, version: denoVersion },
      sandbox,
    };
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}
