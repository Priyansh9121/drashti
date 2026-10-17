import { utilityProcess } from 'electron';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { NetworkService } from './network-service';
import type { FromPerfDevices, PerfDeviceStats, ToPerfDevices } from './perf-devices-worker';

/*
 * For the hand-run performance check (DRASHTI_SELFTEST=performance with
 * DRASHTI_PERF_DEVICES=10): the local network on (this computer only), that
 * many Remote devices paired, and as many feed connections in a utility
 * process of their own (perf-devices-worker.ts; Sessions 31–36, REL-7),
 * following every change while the slide changes are measured. They also say
 * how long each change took to reach them. The tokens are made at run time,
 * handed to that process in a message, and never shown.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The built helper sits next to the main bundle (see electron.vite.config.ts). */
const workerPath = (): string => join(__dirname, 'perf-devices-worker.js');

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
  const child = utilityProcess.fork(workerPath(), [], {
    serviceName: 'Drashti performance devices',
    stdio: 'ignore',
  });
  const told = new Promise<PerfDeviceStats | null>((resolve) => {
    child.on('message', (m: unknown) => {
      resolve((m as FromPerfDevices).stats);
    });
    child.once('exit', () => resolve(null));
  });
  const send = (message: ToPerfDevices) => {
    child.postMessage(message);
  };
  send({ type: 'start', tokens: paired.map((p) => p.token), port, pages: [...pages] });
  for (let i = 0; i < 200 && network.status().connected < count; i++) await sleep(50);
  const connected = network.status().connected;
  let stats = '';
  return {
    summary: () =>
      `${connected} of ${count} devices connected (server ${inMain ? 'in the main process' : 'in its own process'})${stats ? `, changes reached them at ${stats}` : ''}`,
    stop: async () => {
      send({ type: 'stop' });
      const s = await Promise.race([told, sleep(3000).then(() => null)]);
      child.kill();
      if (s)
        stats = `median ${s.median ?? '-'} ms, p90 ${s.p90 ?? '-'} ms, worst ${s.worst ?? '-'} ms (${s.n} deliveries)${pages.length > 0 ? `, while fetching ${s.fetched} page files` : ''}`;
      for (const p of paired) network.revokeDevice(p.id);
      network.setOn(false);
    },
  };
}
