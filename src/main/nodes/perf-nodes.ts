import { utilityProcess } from 'electron';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { NODE_PROTOCOL } from '../../shared/nodes';
import type { Db } from '../db/database';
import type { NodeService } from './node-service';
import type { FromPerfNodes, PerfNodeStats, ToPerfNodes } from './perf-nodes-worker';
import { sw } from '../switches';

/*
 * For the hand-run performance check (DRASHTI_SELFTEST=performance with
 * DRASHTI_PERF_NODES=10): that many output nodes paired with this Main, each
 * following the feed over the node link (TLS, on this computer), reporting
 * its health every two seconds, and copying a generated file of
 * DRASHTI_PERF_NODE_MEDIA_MB megabytes (32 unless given) while the slide
 * changes are measured. They run in a utility process of their own
 * (perf-nodes-worker.ts; Sessions 31–36, REL-7), which trusts this Main's
 * certificate without pinning it (it is the check's own harness, on this
 * computer only). Tokens are made at run time, handed to it in a message,
 * and never shown. The summary gives how late changes reached
 * the nodes and what the link sent: the feed's bytes and the media's.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The built helper sits next to the main bundle (see electron.vite.config.ts). */
const workerPath = (): string => join(__dirname, 'perf-nodes-worker.js');

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
  const megabytes = Math.max(1, Math.min(512, Number(sw('DRASHTI_PERF_NODE_MEDIA_MB') ?? 32) || 32));
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
  const child = utilityProcess.fork(workerPath(), [], {
    serviceName: 'Drashti performance nodes',
    env: {
      ...process.env,
      // The check's own harness trusts this Main's certificate (on this computer only).
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_NO_WARNINGS: '1',
    },
    stdio: 'ignore',
  });
  const told = new Promise<PerfNodeStats | null>((resolve) => {
    child.on('message', (m: unknown) => {
      resolve((m as FromPerfNodes).stats);
    });
    child.once('exit', () => resolve(null));
  });
  const send = (message: ToPerfNodes) => {
    child.postMessage(message);
  };
  send({
    type: 'start',
    tokens: paired.map((p) => p.token),
    port: nodes.status().port,
    version,
    protocol: NODE_PROTOCOL,
    engine: ENGINE_STATE_VERSION,
  });
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
      send({ type: 'stop' });
      const s = await Promise.race([told, sleep(3000).then(() => null)]);
      child.kill();
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
