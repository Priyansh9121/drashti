import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { NetworkService } from './network-service';

/*
 * For the hand-run performance check (DRASHTI_SELFTEST=performance with
 * DRASHTI_PERF_DEVICES=10): the local network on (this computer only), that
 * many Remote devices paired, and as many feed connections in a process of
 * their own, following every change while the slide changes are measured.
 * They also say how long each change took to reach them. The tokens are made
 * at run time, handed to that process on its input, and never shown.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The devices: connect, follow the feed, and on end of input say how late the changes came. */
const CLIENTS = `
const port = Number(process.env.DRASHTI_PERF_PORT);
const pages = JSON.parse(process.env.DRASHTI_PERF_PAGES || '[]');
const sockets = [];
const late = [];
const loads = [];
let fetched = 0;
let input = '';
let started = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  input += d;
  const nl = input.indexOf('\\n');
  if (started || nl < 0) return;
  started = true;
  for (const token of JSON.parse(input.slice(0, nl))) {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/api/v1/feed');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token }));
    // As a phone opening a page does, every second: its largest files.
    if (pages.length > 0)
      loads.push(setInterval(async () => {
        for (const path of pages) {
          try {
            const r = await fetch('http://127.0.0.1:' + port + path);
            await r.arrayBuffer();
            fetched++;
          } catch {}
        }
      }, 1000));
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === 'engine' && m.message.kind === 'patch') late.push(Date.now() - m.message.sentAt);
    };
    sockets.push(ws);
  }
});
process.stdin.on('end', () => {
  for (const t of loads) clearInterval(t);
  late.sort((a, b) => a - b);
  const at = (p) => late[Math.min(late.length - 1, Math.floor((late.length - 1) * p))];
  process.stdout.write('DRASHTI_DEVICE_STATS ' + JSON.stringify({ n: late.length, median: at(0.5), p90: at(0.9), worst: late[late.length - 1], fetched }) + '\\n');
  for (const ws of sockets) ws.close();
  setTimeout(() => process.exit(0), 200);
});
`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
  });
}

export interface PerfDevices {
  /** What the devices saw, once stopped. */
  summary(): string;
  stop(): Promise<void>;
}

/**
 * `pages`: paths each device fetches every second as well (a phone opening a page), or none to
 * only follow the feed.
 */
export async function startPerfDevices(
  network: NetworkService,
  count: number,
  inMain: boolean,
  pages: readonly string[] = [],
): Promise<PerfDevices> {
  const port = await freePort();
  network.setPort(port);
  network.setOn(true);
  for (let i = 0; i < 200 && network.status().state !== 'listening'; i++) await sleep(50);
  if (network.status().state !== 'listening')
    throw new Error(`The network did not start: ${network.status().message ?? ''}`);
  const paired = Array.from({ length: count }, (_, i) =>
    network.pairForCheck('remote', `Performance device ${i + 1}`),
  );
  const child: ChildProcess = spawn(process.execPath, ['-e', CLIENTS], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DRASHTI_PERF_PORT: String(port),
      DRASHTI_PERF_PAGES: JSON.stringify(pages),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stdin?.write(`${JSON.stringify(paired.map((p) => p.token))}\n`);
  for (let i = 0; i < 200 && network.status().connected < count; i++) await sleep(50);
  const connected = network.status().connected;
  let stats = '';
  return {
    summary: () =>
      `${connected} of ${count} devices connected (server ${inMain ? 'in the main process' : 'in its own process'})${stats ? `, changes reached them at ${stats}` : ''}`,
    stop: async () => {
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(resolve, 3000);
      });
      child.stdin?.end();
      await exited;
      const line = out.split('\n').find((l) => l.startsWith('DRASHTI_DEVICE_STATS '));
      if (line) {
        const s = JSON.parse(line.slice('DRASHTI_DEVICE_STATS '.length)) as {
          n: number;
          median?: number;
          p90?: number;
          worst?: number;
          fetched: number;
        };
        stats = `median ${s.median ?? '-'} ms, p90 ${s.p90 ?? '-'} ms, worst ${s.worst ?? '-'} ms (${s.n} deliveries)${pages.length > 0 ? `, while fetching ${s.fetched} page files` : ''}`;
      }
      for (const p of paired) network.revokeDevice(p.id);
      network.setOn(false);
    },
  };
}
