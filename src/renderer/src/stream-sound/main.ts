import type { ProgramContext } from '../../../shared/stream';
import { connectEngine, useEngine } from '../engine/engine-store';
import { holdClock } from '../render/clock';
import { watchGpuRestarts } from '../render/media-attempts';
import { listDevices } from '../program/camera';
import { useProgram } from '../program/program-store';
import { StreamSound } from '../program/sound';
import { EncoderAudio } from '../program/encoder-audio';
import { speechPort } from '../program/speech-tap';

const sound = new StreamSound();
const encoder = new EncoderAudio(() => console.info('[program] the stream’s sound capture stopped'));
let newest: ProgramContext | null = null;
let inputsDone: Promise<void> = listDevices().catch(() => undefined);
let meter: MessagePort | null = null;

function apply(context: ProgramContext): void {
  newest = context;
  useProgram.setState({ context });
  sound.setDelay(context.soundDelayMs);
  sound.setOwnSound(context.mixOwnSound, useEngine.getState().state);
  if (!context.capturing) encoder.stop();
  inputsDone = inputsDone
    .then(async () => {
      if (newest === context) await sound.useInput(context.sound);
    })
    .catch(() => undefined);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const role = (event.data as { drashtiStreamPort?: string } | null)?.drashtiStreamPort;
  const port = event.ports[0];
  if (!port) return;
  if (role === 'encoder-audio') encoder.pair(port, sound.track());
  else if (role === 'speech')
    speechPort(
      port,
      () => sound.inputTrack(),
      () => sound.speechGraph(),
    );
  else if (role === 'sound-meter') {
    meter?.close();
    meter = port;
    port.start();
  }
});

// As before: four 25 ms peak readings form each 100 ms meter report.
let loudest = -100;
let looks = 0;
setInterval(() => {
  loudest = Math.max(loudest, sound.level());
  if (++looks < 4) return;
  document.body.dataset['level'] = String(Math.round(loudest));
  meter?.postMessage({
    db: loudest,
    audio: sound.ctx.state,
    bands: document.body.dataset['bands'] ?? '',
    sound: useProgram.getState().sound,
  });
  loudest = -100;
  looks = 0;
}, 25);

useEngine.subscribe(({ state, rev }) => {
  sound.setOwnSound(newest?.mixOwnSound ?? false, state);
  document.body.dataset['rev'] = String(rev);
});
window.drashti.output.onTestClock(holdClock);
window.drashti.stream.page.onContext(apply);
void window.drashti.stream.page.context().then((context) => {
  if (context) apply(context);
});
navigator.mediaDevices.addEventListener('devicechange', () => {
  void listDevices().then(() => {
    if (newest) apply(newest);
  });
});
watchGpuRestarts();
connectEngine('silent');
