import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { NODE_PROTOCOL } from '../../shared/nodes';
import type { Db } from '../db/database';
import type { NodeService } from './node-service';

/*
 * For the hand-run performance check (DRASHTI_SELFTEST=performance with
 * DRASHTI_PERF_NODES=10): that many output nodes paired with this Main, each
 * following the feed over the node link (TLS, on this computer), reporting
 * its health every two seconds, and copying a generated file of
 * DRASHTI_PERF_NODE_MEDIA_MB megabytes (32 unless given) while the slide
 * changes are measured. They run in a process of their own, which trusts
 * this Main's certificate without pinning it (it is the check's own
 * harness, on this computer only). Tokens are made at run time, handed to it
 * on its input, and never shown. The summary gives how late changes reached
 * the nodes and what the link sent: the feed's bytes and the media's.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const CLIENTS = `
const port = Number(process.env.DRASHTI_PERF_PORT);
const late = [];
let feedBytes = 0;
let mediaBytes = 0;
let mediaMs = 0;
let input = '';
let started = false;
const sockets = [];
const timers = [];
const health = (rev) => ({
  version: process.env.DRASHTI_PERF_VERSION, host: 'Performance node', displays: [], outputs: [],
  media: { wanted: 0, ready: 0, bytesWanted: 0, bytesReady: 0, copying: null, missingNow: 0, problem: null },
  clock: null, rev,
});
async function copy(token, ids) {
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const r = await fetch('https://127.0.0.1:' + port + '/node/v1/media/' + id, { headers: { Authorization: 'Bearer ' + token } });
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; mediaBytes += value.length; }
    } catch {}
    mediaMs += Date.now() - t0;
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  input += d;
  const nl = input.indexOf('\\n');
  if (started || nl < 0) return;
  started = true;
  for (const token of JSON.parse(input.slice(0, nl))) {
    let rev = -1;
    let copying = false;
    const ws = new WebSocket('wss://127.0.0.1:' + port + '/node/v1/feed');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, version: process.env.DRASHTI_PERF_VERSION,
      protocol: Number(process.env.DRASHTI_PERF_PROTOCOL), engine: Number(process.env.DRASHTI_PERF_ENGINE) }));
    ws.onmessage = (e) => {
      const text = String(e.data);
      feedBytes += text.length;
      const m = JSON.parse(text);
      if (m.type === 'engine') { rev = m.message.rev; if (m.message.kind === 'patch') late.push(Date.now() - m.message.sentAt); }
      if (m.type === 'media' && !copying && m.wanted.length > 0) { copying = true; void copy(token, m.wanted.map((w) => w.id)); }
    };
    timers.push(setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'health', health: health(rev) })); }, 2000));
    timers.push(setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'clock', t0: Date.now() })); }, 5000));
    sockets.push(ws);
  }
});
process.stdin.on('end', () => {
  for (const t of timers) clearInterval(t);
  late.sort((a, b) => a - b);
  const at = (p) => late[Math.min(late.length - 1, Math.floor((late.length - 1) * p))];
  process.stdout.write('DRASHTI_NODE_STATS ' + JSON.stringify({ n: late.length, median: at(0.5), p90: at(0.9), worst: late[late.length - 1], feedBytes, mediaBytes, mediaMs }) + '\\n');
  for (const ws of sockets) ws.close();
  setTimeout(() => process.exit(0), 200);
});
`;

export interface PerfNodes {
  summary(): string;
  stop(): Promise<void>;
}

const MB = 1024 * 1024;

/** Pair `count` simulated nodes and start them following the show, each copying a generated file. */
export async function startPerfNodes(
  nodes: NodeService,
  db: Db,
  mediaDir: string,
  count: number,
  version: string,
): Promise<PerfNodes> {
  // One generated file in the library, for every node to copy ("Get everything ready").
  const megabytes = Math.max(1, Math.min(512, Number(process.env['DRASHTI_PERF_NODE_MEDIA_MB'] ?? 32) || 32));
  const bytes = randomBytes(megabytes * MB);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(mediaDir, `${sha256}.mp4`), bytes);
  db.prepare('INSERT INTO media (id, kind, name, path, sha256, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    'video',
    'Performance check file',
    `${sha256}.mp4`,
    sha256,
    bytes.length,
  );
  const paired = Array.from({ length: count }, (_, i) => nodes.pairForCheck(`Performance node ${i + 1}`));
  for (let i = 0; i < 200 && nodes.status().state !== 'listening'; i++) await sleep(50);
  if (nodes.status().state !== 'listening')
    throw new Error(`The node link did not start: ${nodes.status().message ?? ''}`);
  const started = Date.now();
  await nodes.stats(true);
  const child: ChildProcess = spawn(process.execPath, ['-e', CLIENTS], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The check's own harness trusts this Main's certificate (on this computer only).
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_NO_WARNINGS: '1',
      DRASHTI_PERF_PORT: String(nodes.status().port),
      DRASHTI_PERF_VERSION: version,
      DRASHTI_PERF_PROTOCOL: String(NODE_PROTOCOL),
      DRASHTI_PERF_ENGINE: String(ENGINE_STATE_VERSION),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stdin?.write(`${JSON.stringify(paired.map((p) => p.token))}\n`);
  for (let i = 0; i < 200 && nodes.status().nodes.filter((n) => n.online).length < count; i++)
    await sleep(50);
  const online = nodes.status().nodes.filter((n) => n.online).length;
  for (const p of paired) nodes.setEverything(p.id, true);
  let stats = '';
  return {
    summary: () => `${online} of ${count} nodes online${stats ? `, ${stats}` : ''}`,
    stop: async () => {
      const link = await nodes.stats(false);
      const seconds = (Date.now() - started) / 1000;
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(resolve, 3000);
      });
      child.stdin?.end();
      await exited;
      const line = out.split('\n').find((l) => l.startsWith('DRASHTI_NODE_STATS '));
      const s = line
        ? (JSON.parse(line.slice('DRASHTI_NODE_STATS '.length)) as {
            n: number;
            median?: number;
            p90?: number;
            worst?: number;
            mediaBytes: number;
          })
        : null;
      const mbps = (b: number) => (b / MB / Math.max(1, seconds)).toFixed(2);
      stats =
        (s
          ? `changes reached them at median ${s.median ?? '-'} ms, p90 ${s.p90 ?? '-'} ms, worst ${s.worst ?? '-'} ms (${s.n} deliveries); `
          : '') +
        (link
          ? `over ${seconds.toFixed(0)} s the link sent the feed ${(link.feedBytes / 1024).toFixed(0)} KB (${link.feedMessages} messages, ${mbps(link.feedBytes)} MB/s) and media ${(link.mediaBytes / MB).toFixed(1)} MB (${mbps(link.mediaBytes)} MB/s, ${megabytes} MB to each node)`
          : '');
      for (const p of paired) nodes.remove(p.id);
    },
  };
}
