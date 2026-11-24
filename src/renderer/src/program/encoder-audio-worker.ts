import { PcmForwarder } from './pcm-forwarder';

type AudioMessage =
  | { type: 'start'; source: ReadableStream<AudioData>; port: MessagePort }
  | { type: 'pair'; port: MessagePort }
  | { type: 'stop' };

let forwarder: PcmForwarder | null = null;
self.onmessage = (event: MessageEvent<AudioMessage>) => {
  const message = event.data;
  if (message.type === 'start') {
    forwarder?.stop();
    forwarder = new PcmForwarder(message.source, message.port);
    void forwarder.done.then((type) => {
      self.postMessage({ type });
      self.close();
    });
  } else if (message.type === 'pair') {
    if (forwarder) forwarder.pair(message.port);
    else message.port.close();
  } else forwarder?.stop();
};
