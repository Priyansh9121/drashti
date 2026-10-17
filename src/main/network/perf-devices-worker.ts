/*
 * The performance check's devices (DRASHTI_PERF_DEVICES; src/main/network/perf-devices.ts): that many
 * Remote devices following the state feed, in a utility process of their own (Sessions 31–36, REL-7:
 * a packaged Drashti's RunAsNode fuse is off, so Electron no longer runs a script as Node). Each device
 * also fetches the given pages every second, as a phone opening a page does. Told to start with the
 * devices' tokens (made at run time, never shown), and to stop; then it says how late the changes came.
 */

export interface PerfDeviceStats {
  n: number;
  median?: number;
  p90?: number;
  worst?: number;
  fetched: number;
}

export type ToPerfDevices = { type: 'start'; tokens: string[] } | { type: 'stop' };
export interface FromPerfDevices {
  type: 'stats';
  stats: PerfDeviceStats;
}

const port = Number(process.env['DRASHTI_PERF_PORT']);
const pages = JSON.parse(process.env['DRASHTI_PERF_PAGES'] ?? '[]') as string[];
const sockets: WebSocket[] = [];
const late: number[] = [];
const loads: ReturnType<typeof setInterval>[] = [];
let fetched = 0;

function start(tokens: readonly string[]): void {
  for (const token of tokens) {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/v1/feed`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', token }));
    };
    // As a phone opening a page does, every second: its largest files.
    if (pages.length > 0)
      loads.push(
        setInterval(() => {
          void (async () => {
            for (const path of pages) {
              try {
                const r = await fetch(`http://127.0.0.1:${String(port)}${path}`);
                await r.arrayBuffer();
                fetched++;
              } catch {
                // A page that did not come: counted by what did.
              }
            }
          })();
        }, 1000),
      );
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as { type: string; message?: { kind: string; sentAt: number } };
      if (m.type === 'engine' && m.message?.kind === 'patch') late.push(Date.now() - m.message.sentAt);
    };
    sockets.push(ws);
  }
}

function stop(): void {
  for (const t of loads) clearInterval(t);
  late.sort((a, b) => a - b);
  const at = (p: number) => late[Math.min(late.length - 1, Math.floor((late.length - 1) * p))];
  const said: FromPerfDevices = {
    type: 'stats',
    stats: { n: late.length, median: at(0.5), p90: at(0.9), worst: late.at(-1), fetched },
  };
  process.parentPort.postMessage(said);
  for (const ws of sockets) ws.close();
  setTimeout(() => process.exit(0), 200);
}

process.parentPort.on('message', (e) => {
  const message = e.data as ToPerfDevices;
  if (message.type === 'start') start(message.tokens);
  else stop();
});
