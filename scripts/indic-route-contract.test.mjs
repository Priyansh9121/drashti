import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndicRoute } from '../src/main/speech/indic-route.ts';
const pack = {
  format: 'indicconformer-ctc-onnx-v1',
  purposes: ['captions-gu'],
  files: [
    { name: 'model.onnx', path: '/p/model.onnx', sha256: '1'.repeat(64) },
    { name: 'tokens.txt', path: '/p/tokens.txt', sha256: '1'.repeat(64) },
    { name: 'frontend.bin', path: '/p/frontend.bin', sha256: '1'.repeat(64) },
  ],
};
const base = {
  program: () => '/native',
  workGate: { allowed: () => true, listen: () => () => {} },
  sound: { open: () => () => {} },
  log: { info() {}, warn() {} },
};

test('the shared route factory looks up full checked metadata from the selected model id', async () => {
  let released = 0,
    requested,
    ready;
  const listening = new Promise((done) => {
    ready = done;
  });
  const route = createIndicRoute({
    ...base,
    store: {
      model: (id) => (id === 'chosen' ? pack : null),
      acquire: async (id, signal) => {
        assert.equal(id, 'chosen');
        assert.ok(signal instanceof AbortSignal);
        return {
          model: pack,
          release: () => {
            released += 1;
          },
        };
      },
    },
    open: async (options) => {
      requested = options.files;
      return { decode: async () => ({}), close() {} };
    },
  });
  assert.equal(route.id, 'conformer');
  assert.equal(route.make({ ...pack, id: 'missing' }, 'gu'), null);
  assert.equal(route.make({ ...pack, id: 'chosen' }, 'en'), null);
  const engine = route.make({ ...pack, id: 'chosen' }, 'gu');
  assert.ok(engine);
  const stop = engine.start('gu', {
    heard() {},
    state: (state) => {
      if (state.phase === 'listening') ready();
    },
  });
  await listening;
  assert.deepEqual(requested, {
    model: '/p/model.onnx',
    tokens: '/p/tokens.txt',
    frontend: '/p/frontend.bin',
  });
  stop();
  assert.equal(released, 1);
});

test('changed or wrong-language held metadata is released without starting the helper', async () => {
  let released = 0,
    started = 0,
    state;
  const route = createIndicRoute({
    ...base,
    store: {
      model: () => pack,
      acquire: async () => ({
        model: { ...pack, purposes: ['captions-hi'] },
        release: () => {
          released += 1;
        },
      }),
    },
    open: async () => {
      started += 1;
      throw new Error('must not start');
    },
  });
  const engine = route.make({ ...pack, id: 'chosen' }, 'gu');
  const stop = engine.start('gu', {
    heard() {},
    state: (s) => {
      state = s;
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(state, { phase: 'held', reason: 'no-model' });
  assert.equal(started, 0);
  assert.equal(released, 1);
  stop();
});

test('a replacement model under the same id cannot silently change the selected recogniser identity', async () => {
  let released = 0,
    started = 0;
  const first = { ...pack, files: pack.files.map((file) => ({ ...file, sha256: '1'.repeat(64) })) };
  const replacement = { ...first, files: first.files.map((file) => ({ ...file, sha256: '2'.repeat(64) })) };
  const route = createIndicRoute({
    ...base,
    store: {
      model: () => first,
      acquire: async () => ({
        model: replacement,
        release: () => {
          released += 1;
        },
      }),
    },
    open: async () => {
      started += 1;
      return { decode: async () => ({}), close() {} };
    },
  });
  const engine = route.make({ ...pack, id: 'chosen' }, 'gu');
  const stop = engine.start('gu', { heard() {}, state() {} });
  try {
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started, 0);
    assert.equal(released, 1);
  } finally {
    stop();
  }
});

test('a selected file reference cannot be replaced by different metadata returned for the same id', () => {
  const first = { ...pack, files: pack.files.map((file) => ({ ...file, sha256: '1'.repeat(64) })) };
  const selected = {
    ...first,
    id: 'chosen',
    files: first.files.map((file) => ({ ...file, sha256: '2'.repeat(64) })),
  };
  const route = createIndicRoute({ ...base, store: { model: () => first, acquire: async () => null } });
  assert.equal(route.make(selected, 'gu'), null);
});
