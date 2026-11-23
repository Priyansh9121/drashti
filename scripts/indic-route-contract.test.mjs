import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndicRoute } from '../src/main/speech/indic-route.ts';
const pack = { format: 'indicconformer-ctc-onnx-v1', purposes: ['captions-gu'], files: [
  { name: 'model.onnx', path: '/p/model.onnx' }, { name: 'tokens.txt', path: '/p/tokens.txt' }, { name: 'frontend.bin', path: '/p/frontend.bin' },
] };
const base = { program: () => '/native', workGate: { allowed: () => true, listen: () => () => {} }, sound: { open: () => () => {} }, log: { info() {}, warn() {} } };

test('the shared route factory looks up full checked metadata from the selected model id', async () => {
  let released = 0, requested, ready;
  const listening = new Promise((done) => { ready = done; });
  const route = createIndicRoute({ ...base, store: {
    model: (id) => id === 'chosen' ? pack : null,
    acquire: async (id, signal) => { assert.equal(id, 'chosen'); assert.ok(signal instanceof AbortSignal); return { model: pack, release: () => { released += 1; } }; },
  }, open: async (options) => { requested = options.files; return { decode: async () => ({}), close() {} }; } });
  assert.equal(route.id, 'conformer');
  assert.equal(route.make({ id: 'missing' }, 'gu'), null);
  assert.equal(route.make({ id: 'chosen' }, 'en'), null);
  const engine = route.make({ id: 'chosen' }, 'gu');
  assert.ok(engine);
  const stop = engine.start('gu', { heard() {}, state: (state) => { if (state.phase === 'listening') ready(); } });
  await listening;
  assert.deepEqual(requested, { model: '/p/model.onnx', tokens: '/p/tokens.txt', frontend: '/p/frontend.bin' });
  stop(); assert.equal(released, 1);
});

test('changed or wrong-language held metadata is released without starting the helper', async () => {
  let released = 0, started = 0, state;
  const route = createIndicRoute({ ...base, store: {
    model: () => pack,
    acquire: async () => ({ model: { ...pack, purposes: ['captions-hi'] }, release: () => { released += 1; } }),
  }, open: async () => { started += 1; throw new Error('must not start'); } });
  const engine = route.make({ id: 'chosen' }, 'gu');
  const stop = engine.start('gu', { heard() {}, state: (s) => { state = s; } });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(state, { phase: 'held', reason: 'no-model' });
  assert.equal(started, 0); assert.equal(released, 1); stop();
});
