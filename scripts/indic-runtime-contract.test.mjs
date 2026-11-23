// Node's type stripping checks the transport contract without Electron/build/start-up. Vitest separately covers
// the full speech-engine integration under the shared heavy lock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pcmFrame, indicWords, routeCFiles } from '../src/main/speech/indic-protocol.ts';
test('PCM and native words have strict audio and timing bounds', () => {
  assert.deepEqual([...pcmFrame(new Int16Array([-32768, 1, 32767]))], [6, 0, 0, 0, 0, 128, 1, 0, 255, 127]);
  assert.throws(() => pcmFrame(new Int16Array(192001)), /PCM bounds/);
  assert.throws(() => indicWords({ language: 'hi', words: [] }, 'gu', 0, 1000), /Invalid recogniser reply/);
  assert.deepEqual(
    indicWords({ language: 'gu', words: [{ w: 'shape', start: 0.04, end: 1 }] }, 'gu', 1000, 1500),
    [{ text: 'shape', startAt: 1040, endAt: 1500, confidence: null }],
  );
});

test('the shared recogniser seam refuses unsupported languages even if a pack claims them', () => {
  const pack = { format: 'indicconformer-ctc-onnx-v1', purposes: ['captions-en'], files: [
    { name: 'model.onnx', path: '/p/model.onnx' }, { name: 'tokens.txt', path: '/p/tokens.txt' }, { name: 'frontend.bin', path: '/p/frontend.bin' },
  ] };
  assert.equal(routeCFiles(pack, 'en'), null);
});
