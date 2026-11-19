import type { MessagePortMain } from 'electron';
import type { FromProgram } from '../stream/worker/protocol';
import { FrameReceiver, REPEAT_MS, type Sender } from './frames';
import { ProgramSender } from './program-sender';
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

/** The program for this computer's way ended: said, then this process ends too, for main to start it again. */
function programEnded(message: string): void {
  log('warn', message);
  if (receiver) send({ type: 'status', status: receiver.status() });
  setTimeout(() => {
    process.exit(3);
  }, 200);
}

function senderFor(chosen: VideoOutSender, name: string): Sender {
  if (chosen.way === 'stand-in') return new StandInSender(chosen.file, name);
  // Syphon on a Mac, Spout on Windows: Drashti's own small program (tools/video-out/).
  return new ProgramSender(chosen.program, name, log, programEnded);
}

// A still picture goes out again (FrameReceiver.repeat): looked at twice as often as it may go.
setInterval(() => {
  receiver?.repeat();
}, REPEAT_MS / 2);

port.on('message', (event) => {
  const message = event.data as ToVideoOutWorker | { type: 'frames' };
  switch (message.type) {
    case 'start': {
      sender?.stop();
      sender = senderFor(message.sender, message.name);
      receiver = new FrameReceiver(
        sender,
        (status) => {
          send({ type: 'status', status });
        },
        Date.now,
        log,
      );
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
      // The program's input ends (it stops by itself); this process a moment later.
      sender?.stop();
      sender = null;
      receiver = null;
      setTimeout(() => {
        process.exit(0);
      }, 300);
  }
});
