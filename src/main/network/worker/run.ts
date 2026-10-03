import { NetworkServer } from '../server';
import type { FromNetworkWorker, ToNetworkWorker, WorkerAnswers, WorkerQuestion } from './protocol';

/*
 * The network worker's work, whichever process it runs in: the utility
 * process (worker.ts, what Drashti uses), or the main process itself, which
 * only the performance check does, to compare the two.
 */

const ANSWER_WITHIN_MS = 10_000;

/** What a question gets if the main process does not answer in time. */
const noAnswer: { [K in keyof WorkerAnswers]: WorkerAnswers[K] } = {
  request: { status: 503, body: { ok: false, message: 'Drashti is busy: try again.' } },
  pair: { ok: false, status: 503, message: 'Drashti is busy: try again.' },
  media: null,
};

/** Start the worker's server; returns what to do with each message from the main process. */
export function runNetworkWorker(
  send: (message: FromNetworkWorker) => void,
): (message: ToNetworkWorker) => void {
  let nextId = 1;
  const waiting = new Map<number, (answer: unknown) => void>();
  const ask = <K extends WorkerQuestion['kind']>(
    question: Extract<WorkerQuestion, { kind: K }>,
  ): Promise<WorkerAnswers[K]> =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve(noAnswer[question.kind]);
      }, ANSWER_WITHIN_MS);
      waiting.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer as WorkerAnswers[K]);
      });
      send({ type: 'ask', id, question });
    });

  const server = new NetworkServer({
    request: (request) => ask({ kind: 'request', request }),
    pair: (code, address) => ask({ kind: 'pair', code, address }),
    mediaSource: (mediaId) => ask({ kind: 'media', mediaId }),
    connected: (deviceIds) => {
      send({ type: 'connected', deviceIds });
    },
    seen: (deviceId) => {
      send({ type: 'seen', deviceId });
    },
    resync: () => {
      send({ type: 'resync' });
    },
    log: (level, message) => {
      send({ type: 'log', level, message });
    },
  });

  return (message) => {
    switch (message.type) {
      case 'start':
        void server.start(message.options).then((result) => {
          send({ type: 'started', result });
        });
        return;
      case 'stop':
        void server.stop(message.reason).then(() => {
          send({ type: 'stopped' });
        });
        return;
      case 'engine':
        server.engine(message.message);
        return;
      case 'devices':
        server.setDevices(message.devices);
        return;
      case 'hint':
        server.hint(message.what);
        return;
      case 'answer': {
        const resolve = waiting.get(message.id);
        waiting.delete(message.id);
        resolve?.(message.answer);
        return;
      }
    }
  };
}
