import workletUrl from './speech-worklet.ts?worker&url';
export { SPEECH_RATE, SpeechResampler } from './speech-resampler';

/** The existing stream graph's raw input and silent destination; this tap never opens a device or loudspeaker. */
export interface SpeechGraph {
  context: AudioContext;
  source: AudioNode;
  sink: AudioNode;
}

let port: MessagePort | null = null;
let trackOf: () => MediaStreamTrack | null = () => null;
let graphOf: () => SpeechGraph | null = () => null;
let generation = 0;
let pending: number | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let active: { track: MediaStreamTrack; source: AudioNode; stop(): void } | null = null;
const modules = new WeakMap<AudioContext, Promise<void>>();

function later(): void {
  if (!port || retry) return;
  // eslint-disable-next-line no-restricted-syntax -- notice a replaced/ended microphone, never decide a picture frame
  retry = setTimeout(() => {
    retry = null;
    void update();
  }, 1_000);
}

/** Keep capture off the drawing/encoding thread: its track processor drops queued audio when the renderer is busy. */
async function update(): Promise<void> {
  const to = port;
  const mine = generation;
  if (!to || pending === mine) return;
  const track = trackOf();
  const graph = graphOf();
  if (active) {
    if (active.track === track && active.source === graph?.source && track.readyState === 'live') {
      later();
      return;
    }
    active.stop();
    active = null;
  }
  if (track?.readyState !== 'live' || !graph) {
    later();
    return;
  }
  pending = mine;
  try {
    let ready = modules.get(graph.context);
    if (!ready) {
      ready = graph.context.audioWorklet.addModule(workletUrl);
      modules.set(graph.context, ready);
      void ready.catch(() => modules.delete(graph.context));
    }
    await ready;
    if (port !== to || generation !== mine || trackOf() !== track || graphOf()?.source !== graph.source)
      return;
    const node = new AudioWorkletNode(graph.context, 'drashti-speech', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (port !== to || generation !== mine || track.readyState !== 'live') return;
      if (typeof event.data !== 'object' || event.data === null) return;
      const data = event.data as { samples?: unknown; startAt?: unknown; endAt?: unknown };
      if (
        !(data.samples instanceof Int16Array) ||
        typeof data.startAt !== 'number' ||
        typeof data.endAt !== 'number'
      )
        return;
      // Electron's Main port turns a transferred ArrayBuffer into null. Clone this bounded 3.2 KB batch instead.
      to.postMessage({ kind: 'pcm', samples: data.samples, startAt: data.startAt, endAt: data.endAt });
    };
    node.port.start();
    graph.source.connect(node).connect(graph.sink);
    active = {
      track,
      source: graph.source,
      stop: () => {
        // Only this silent branch: the stream's own input remains connected and its track stays live.
        try {
          graph.source.disconnect(node);
        } catch {
          // A replaced input already disconnected all its branches.
        }
        node.disconnect();
        node.port.onmessage = null;
        node.port.postMessage('stop');
        node.port.close();
      },
    };
  } catch {
    // A device/context went away or its module could not load. Retry without blocking the show.
  } finally {
    if (pending === mine) pending = null;
    if (generation === mine) later();
  }
}

/** Main's port for live captions; null, or closing its other end, stops the tap immediately. */
export function speechPort(
  next: MessagePort | null,
  track: () => MediaStreamTrack | null,
  graph: () => SpeechGraph | null = () => null,
): void {
  generation++;
  const was = port;
  port = next;
  if (was) {
    was.onmessage = null;
    was.close();
  }
  if (retry) clearTimeout(retry);
  retry = null;
  active?.stop();
  active = null;
  trackOf = track;
  graphOf = graph;
  if (!next) return;
  const closed = () => {
    if (port === next) speechPort(null, () => null);
  };
  next.addEventListener('close', closed, { once: true });
  next.start();
  void update();
}
