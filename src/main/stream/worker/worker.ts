import { StreamPipeline } from './pipeline';
import type { FromProgram, FromStreamWorker, ToStreamWorker } from './protocol';

/*
 * The stream worker: an Electron utility process (started by
 * src/main/stream/stream-worker.ts), so the main process, which carries
 * every slide change, never touches a frame. It receives the Program's
 * frames and sound straight from the stream's page on a port, runs FFmpeg
 * to encode, send and record, and reports how it is going.
 */

const port = process.parentPort;
const send = (message: FromStreamWorker) => {
  port.postMessage(message);
};

const pipeline = new StreamPipeline({
  status: (status) => {
    send({ type: 'status', status });
  },
  log: (level, message) => {
    send({ type: 'log', level, message });
  },
});

port.on('message', (event) => {
  const message = event.data as ToStreamWorker | { type: 'frames' };
  switch (message.type) {
    case 'frames': {
      const frames = event.ports[0];
      if (!frames) return;
      frames.on('message', (e) => {
        pipeline.fromProgram(e.data as FromProgram);
      });
      frames.start();
      return;
    }
    case 'start':
      void pipeline.start(message);
      return;
    case 'live':
      pipeline.goLive(message.url, message.key);
      return;
    case 'endLive':
      pipeline.endLive();
      return;
    case 'record':
      pipeline.record(message.file, message.keepFreeBytes);
      return;
    case 'stopRecording':
      pipeline.stopRecording(message.message);
      return;
    case 'stop':
      pipeline.stop();
      // FFmpeg gets a moment to finish the recording's last cluster.
      setTimeout(() => {
        process.exit(0);
      }, 3500);
      return;
  }
});
