import type { MessagePortMain } from 'electron';
import type { FromProgram } from '../stream/worker/protocol';
import { FrameReceiver, type Sender } from './frames';
import type { FromVideoOutWorker, ToVideoOutWorker, VideoOutSender } from './protocol';
import { StandInSender } from './stand-in';

/*
 * The video-out process (x30): an Electron utility process (started by ./spawn.ts) only while video out is on, so
 * the main process, which carries every slide change, never touches a frame. It receives the stream's page's frames
 * on a port and hands them to the sender for this computer's way.
 */

const port = process.parentPort;
const send = (message: FromVideoOutWorker) => {
  port.postMessage(message);
};
const log = (level: 'info' | 'warn', message: string) => {
  send({ type: 'log', level, message });
};

let receiver: FrameReceiver | null = null;
let sender: Sender | null = null;
/** The stream's page's port now: a newer one (the page loaded again) replaces it. */
let frames: MessagePortMain | null = null;

function senderFor(chosen: VideoOutSender, name: string): Sender | null {
  if (chosen.way === 'stand-in') return new StandInSender(chosen.file, name);
  // Drashti's own program for Syphon, Spout or NDI comes with the owner's choice (N/reports/x30-design.md).
  log('warn', `No sender for ${chosen.way} in this build`);
  return null;
}

port.on('message', (event) => {
  const message = event.data as ToVideoOutWorker | { type: 'frames' };
  switch (message.type) {
    case 'start': {
      sender?.stop();
      sender = senderFor(message.sender, message.name);
      receiver = sender
        ? new FrameReceiver(
            sender,
            (status) => {
              send({ type: 'status', status });
            },
            Date.now,
            log,
          )
        : null;
      if (!sender)
        send({
          type: 'status',
          status: {
            frames: 0,
            dropped: 0,
            size: null,
            error: 'This computer’s Drashti cannot send the picture.',
          },
        });
      return;
    }
    case 'frames': {
      const next = event.ports[0];
      if (!next) return;
      frames?.close();
      frames = next;
      next.on('message', (e) => {
        if (frames === next) receiver?.fromProgram(e.data as FromProgram);
      });
      next.start();
      return;
    }
    case 'stop':
      sender?.stop();
      sender = null;
      receiver = null;
      process.exit(0);
  }
});
