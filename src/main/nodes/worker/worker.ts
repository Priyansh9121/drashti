import type { ToLinkWorker } from './protocol';
import { runLinkWorker } from './run';

/*
 * The node link worker: an Electron utility process (started by
 * src/main/nodes/link-worker.ts) that runs Main's side of the node link, so
 * the main process, which carries every slide change, hands it each engine
 * message once and the worker sends it to every node.
 */

const port = process.parentPort;
const handle = runLinkWorker((message) => {
  port.postMessage(message);
});
port.on('message', (event) => {
  handle(event.data as ToLinkWorker);
});
