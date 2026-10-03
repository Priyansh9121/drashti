import type { ToNetworkWorker } from './protocol';
import { runNetworkWorker } from './run';

/*
 * The network worker: an Electron utility process (started by
 * src/main/network/network-worker.ts) that runs Drashti's HTTP and WebSocket
 * server, so the main process, which carries every slide change, hands it
 * each engine message once and the worker sends it to every device.
 */

const port = process.parentPort;
const handle = runNetworkWorker((message) => {
  port.postMessage(message);
});
port.on('message', (event) => {
  handle(event.data as ToNetworkWorker);
});
