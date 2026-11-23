import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndicEngine } from '../src/main/speech/indic-engine.ts';
test('unselected language cannot acquire a model or open sound', () => {
  let acquired = false,
    opened = false,
    state;
  const engine = createIndicEngine({
    program: () => '/native',
    acquire: () => {
      acquired = true;
      return null;
    },
    sound: {
      open: () => {
        opened = true;
        return null;
      },
    },
    log: { info() {}, warn() {} },
  });
  engine.start('auto', {
    heard() {},
    state: (s) => {
      state = s;
    },
  })();
  assert.equal(acquired, false);
  assert.equal(opened, false);
  assert.equal(state.phase, 'failed');
});

test('stop during asynchronous pack checking releases the late hold without starting sound or compute', async () => {
  let resolveHold;
  const hold = new Promise((done) => {
    resolveHold = done;
  });
  let releases = 0,
    opens = 0;
  const engine = createIndicEngine({
    program: () => '/native',
    acquire: () => hold,
    sound: {
      open: () => {
        opens += 1;
        return null;
      },
    },
    open: async () => {
      throw new Error('must not start');
    },
    log: { info() {}, warn() {} },
  });
  const stop = engine.start('gu', { heard() {}, state() {} });
  stop();
  resolveHold({
    files: { model: '/m', tokens: '/t', frontend: '/f' },
    release: () => {
      releases += 1;
    },
  });
  await hold;
  await Promise.resolve();
  assert.equal(releases, 1);
  assert.equal(opens, 0);
});

test('late native inference cannot publish into a stopped session', async () => {
  let capture, reply, ready;
  const listening = new Promise((done) => {
    ready = done;
  });
  const decoded = new Promise((done) => {
    reply = done;
  });
  let published = 0,
    releases = 0;
  const engine = createIndicEngine({
    program: () => '/native',
    acquire: () => ({
      files: { model: '/m', tokens: '/t', frontend: '/f' },
      release: () => {
        releases += 1;
      },
    }),
    sound: {
      open: (to) => {
        capture = to;
        return () => {};
      },
    },
    open: async () => ({ decode: () => decoded, close() {} }),
    log: { info() {}, warn() {} },
  });
  const stop = engine.start('gu', {
    heard: () => {
      published += 1;
    },
    state: (state) => {
      if (state.phase === 'listening') ready();
    },
  });
  await listening;
  const began = Date.now() - 800;
  capture(new Int16Array(1600).fill(5000), began + 100, began);
  for (let i = 1; i <= 7; i += 1) capture(new Int16Array(1600), began + (i + 1) * 100, began + i * 100);
  stop();
  reply({ language: 'gu', words: [{ w: 'shape', start: 0, end: 0.08 }] });
  await decoded;
  await Promise.resolve();
  assert.equal(published, 0);
  assert.equal(releases, 1);
});

test('without an authoritative background-work gate no model can load', async () => {
  let acquired = false;
  const engine = createIndicEngine({ program: () => '/native', acquire: () => { acquired = true; return null; }, sound: { open: () => null }, log: { info() {}, warn() {} } });
  const stop = engine.start('gu', { heard() {}, state() {} });
  await Promise.resolve();
  stop();
  assert.equal(acquired, false);
});
