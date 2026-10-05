import { LinkServer } from '../link-server';
import type { FromLinkWorker, LinkAnswers, LinkQuestion, ToLinkWorker } from './protocol';

/*
 * The node link worker's work, whichever process it runs in: the utility
 * process (worker.ts), or the main process itself in unit tests.
 */

const ANSWER_WITHIN_MS = 10_000;

const noAnswer: { [K in keyof LinkAnswers]: LinkAnswers[K] } = { paired: null, media: null };

export function runLinkWorker(send: (message: FromLinkWorker) => void): (message: ToLinkWorker) => void {
  let nextId = 1;
  const waiting = new Map<number, (answer: unknown) => void>();
  const ask = <K extends LinkQuestion['kind']>(
    question: Extract<LinkQuestion, { kind: K }>,
  ): Promise<LinkAnswers[K]> =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve(noAnswer[question.kind]);
      }, ANSWER_WITHIN_MS);
      waiting.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer as LinkAnswers[K]);
      });
      send({ type: 'ask', id, question });
    });

  const server = new LinkServer({
    paired: (node) => ask({ kind: 'paired', node }),
    mediaFile: (mediaId) => ask({ kind: 'media', mediaId }),
    offerDropped: () => {
      send({ type: 'offer-dropped' });
    },
    online: (nodeId, address, version) => {
      send({ type: 'online', nodeId, address, version });
    },
    offline: (nodeId) => {
      send({ type: 'offline', nodeId });
    },
    health: (nodeId, health) => {
      send({ type: 'health', nodeId, health });
    },
    thumb: (nodeId, screenId, jpeg) => {
      send({ type: 'thumb', nodeId, screenId, jpeg });
    },
    refused: (nodeId, version) => {
      send({ type: 'refused', nodeId, version });
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
        void server.stop('closing').then(() => {
          send({ type: 'stopped' });
        });
        return;
      case 'engine':
        server.engine(message.message);
        return;
      case 'nodes':
        server.setNodes(message.nodes);
        return;
      case 'offer':
        server.setOffer(message.offer);
        return;
      case 'screens':
        server.setScreens(message.nodeId, message.screens);
        return;
      case 'media':
        server.setWanted(message.nodeId, message.wanted);
        return;
      case 'rate':
        server.setRate(message.bytesPerSecond);
        return;
      case 'thumbs':
        server.setThumbs(message.everyMs);
        return;
      case 'to-node':
        server.toNode(message.nodeId, message.message);
        return;
      case 'stats':
        send({ type: 'stats', stats: server.stats() });
        if (message.reset) server.resetStats();
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
