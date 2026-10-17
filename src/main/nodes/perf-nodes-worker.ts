/*
 * The performance check's nodes (DRASHTI_PERF_NODES; src/main/nodes/perf-nodes.ts): that many output nodes
 * following the feed over the node link (TLS, on this computer), reporting their health every two seconds
 * and copying the file Main offers, in a utility process of their own (Sessions 31–36, REL-7: a packaged
 * Drashti's RunAsNode fuse is off, so Electron no longer runs a script as Node). It trusts this Main's
 * certificate without pinning it (NODE_TLS_REJECT_UNAUTHORIZED, given by Main: the check's own harness, on
 * this computer only). Told to start with the nodes' tokens (made at run time, never shown), and to stop;
 * then it says how late the changes came and what the link sent.
 */

export interface PerfNodeStats {
  n: number;
  median?: number;
  p90?: number;
  worst?: number;
  feedBytes: number;
  mediaBytes: number;
  mediaMs: number;
}

export type ToPerfNodes = { type: 'start'; tokens: string[] } | { type: 'stop' };
export interface FromPerfNodes {
  type: 'stats';
  stats: PerfNodeStats;
}

const port = Number(process.env['DRASHTI_PERF_PORT']);
const version = process.env['DRASHTI_PERF_VERSION'] ?? '';
const late: number[] = [];
const sockets: WebSocket[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
let feedBytes = 0;
let mediaBytes = 0;
let mediaMs = 0;

const health = (rev: number) => ({
  version,
  host: 'Performance node',
  displays: [],
  outputs: [],
  media: {
    wanted: 0,
    ready: 0,
    bytesWanted: 0,
    bytesReady: 0,
    copying: null,
    missingNow: 0,
    problem: null,
  },
  clock: null,
  rev,
});

async function copy(token: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://127.0.0.1:${String(port)}/node/v1/media/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const reader = (r.body as ReadableStream<Uint8Array> | null)?.getReader();
      for (;;) {
        const read = await reader?.read();
        if (!read || read.done) break;
        mediaBytes += read.value.length;
      }
    } catch {
      // A copy that broke off: counted by what came.
    }
    mediaMs += Date.now() - t0;
  }
}

function start(tokens: readonly string[]): void {
  for (const token of tokens) {
    let rev = -1;
    let copying = false;
    const ws = new WebSocket(`wss://127.0.0.1:${String(port)}/node/v1/feed`);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          token,
          version,
          protocol: Number(process.env['DRASHTI_PERF_PROTOCOL']),
          engine: Number(process.env['DRASHTI_PERF_ENGINE']),
        }),
      );
    };
    ws.onmessage = (e: MessageEvent) => {
      const text = String(e.data);
      feedBytes += text.length;
      const m = JSON.parse(text) as {
        type: string;
        message?: { rev: number; kind: string; sentAt: number };
        wanted?: { id: string }[];
      };
      if (m.type === 'engine' && m.message) {
        rev = m.message.rev;
        if (m.message.kind === 'patch') late.push(Date.now() - m.message.sentAt);
      }
      if (m.type === 'media' && !copying && (m.wanted?.length ?? 0) > 0) {
        copying = true;
        void copy(
          token,
          (m.wanted ?? []).map((w) => w.id),
        );
      }
    };
    timers.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'health', health: health(rev) }));
      }, 2000),
    );
    timers.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'clock', t0: Date.now() }));
      }, 5000),
    );
    sockets.push(ws);
  }
}

function stop(): void {
  for (const t of timers) clearInterval(t);
  late.sort((a, b) => a - b);
  const at = (p: number) => late[Math.min(late.length - 1, Math.floor((late.length - 1) * p))];
  const said: FromPerfNodes = {
    type: 'stats',
    stats: {
      n: late.length,
      median: at(0.5),
      p90: at(0.9),
      worst: late.at(-1),
      feedBytes,
      mediaBytes,
      mediaMs,
    },
  };
  process.parentPort.postMessage(said);
  for (const ws of sockets) ws.close();
  setTimeout(() => process.exit(0), 200);
}

process.parentPort.on('message', (e) => {
  const message = e.data as ToPerfNodes;
  if (message.type === 'start') start(message.tokens);
  else stop();
});
