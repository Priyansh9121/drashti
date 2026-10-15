import { lookup } from 'node:dns/promises';
import { constants, setPriority } from 'node:os';
import { post } from './post';
import type { ToEventsWorker } from './protocol';
import { eventsSender } from './sender';

/*
 * The events worker (Session 28): an Electron utility process that sends events out, at the lowest
 * priority, so a receiver that is slow or hangs never holds up the show, and quitting never waits for it.
 * It prints nothing: an address or a secret never reaches the log.
 */

const port = process.parentPort;

try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Not allowed on this system: run at normal priority.
}

const handle = eventsSender(
  (message) => {
    port.postMessage(message);
  },
  {
    post,
    resolve: (host) => lookup(host, { all: true, verbatim: true }),
    now: Date.now,
    later: (ms, wake) => {
      const timer = setTimeout(wake, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    random: Math.random,
  },
);

port.on('message', (event: { data: unknown }) => {
  handle(event.data as ToEventsWorker);
});
