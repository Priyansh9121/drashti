import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { openIndicPipe } from '../src/main/speech/indic-pipe.ts';
test('native model load is admitted only after priority is established', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {},
    pid: 1,
  });
  let prioritised = false;
  const writes = [];
  child.stdin.on('data', (data) => {
    assert.equal(prioritised, true);
    writes.push(data);
  });
  const opening = openIndicPipe({
    program: '/fake',
    language: 'gu',
    files: { model: '/model', tokens: '/tokens', frontend: '/frontend' },
    spawn: () => child,
    priority: () => {
      prioritised = true;
    },
  });
  child.stdout.emit(
    'data',
    Buffer.from(
      '{"ready":true,"protocolVersion":1,"sampleRate":16000,"channels":1,"sampleFormat":"s16le"}\n',
    ),
  );
  const pipe = await opening;
  try {
    assert.deepEqual(writes, [Buffer.from('GO01')]);
  } finally {
    pipe.close();
  }
});

test('a failed priority assignment never admits load and closes its child', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {
      this.killed = true;
    },
    pid: 1,
  });
  const writes = [];
  child.stdin.on('data', (data) => writes.push(data));
  await assert.rejects(
    openIndicPipe({
      program: '/fake',
      language: 'gu',
      files: { model: '/model', tokens: '/tokens', frontend: '/frontend' },
      spawn: () => child,
      priority: () => {
        throw new Error('priority');
      },
    }),
    /priority/,
  );
  assert.deepEqual(writes, []);
  assert.equal(child.killed, true);
});

test('a private request is rejected on close and no late reply is reused', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {},
    pid: 1,
  });
  const opening = openIndicPipe({
    program: '/fake',
    language: 'gu',
    files: { model: '/model', tokens: '/tokens', frontend: '/frontend' },
    spawn: () => child,
    priority() {},
  });
  child.stdout.emit(
    'data',
    Buffer.from(
      '{"ready":true,"protocolVersion":1,"sampleRate":16000,"channels":1,"sampleFormat":"s16le"}\n',
    ),
  );
  const pipe = await opening;
  const pending = pipe.decode(new Int16Array([1, 2]));
  const cancelled = assert.rejects(pending, /closed/);
  assert.throws(() => pipe.decode(new Int16Array([3, 4])), /busy/);
  pipe.close();
  child.stdout.emit('data', Buffer.from('{"language":"gu","words":[]}\n'));
  await cancelled;
  assert.throws(() => pipe.decode(new Int16Array([5, 6])), /closed/);
});

test('malformed UTF-8 and output over 64KiB close the child without forwarding text', async () => {
  for (const bytes of [Buffer.from([0xff, 10]), Buffer.alloc(65537, 32)]) {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill() {
        this.killed = true;
      },
      pid: 1,
    });
    const opening = openIndicPipe({
      program: '/fake',
      language: 'gu',
      files: { model: '/model', tokens: '/tokens', frontend: '/frontend' },
      spawn: () => child,
      priority() {},
    });
    const rejected = assert.rejects(opening, /protocol/);
    child.stdout.emit('data', bytes);
    await rejected;
    assert.equal(child.killed, true);
  }
});

test('readiness without protocol and audio-format negotiation is refused', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill() {},
    pid: 1,
  });
  const opening = openIndicPipe({
    program: '/fake',
    language: 'gu',
    files: { model: '/model', tokens: '/tokens', frontend: '/frontend' },
    spawn: () => child,
    priority() {},
  });
  child.stdout.emit('data', Buffer.from('{"ready":true}\n'));
  await assert.rejects(
    opening.then((pipe) => {
      pipe.close();
      return pipe;
    }),
    /protocol/,
  );
});

test('a stalled native request reports lag at the existing eight-second bound', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {}, pid: 1 });
  const reasons = [];
  const opening = openIndicPipe({ program: '/fake', language: 'gu', files: { model: '/model', tokens: '/tokens', frontend: '/frontend' }, spawn: () => child, priority() {}, failed: (reason) => reasons.push(reason) });
  child.stdout.emit('data', Buffer.from('{"ready":true,"protocolVersion":1,"sampleRate":16000,"channels":1,"sampleFormat":"s16le"}\n'));
  const pipe = await opening;
  const pending = pipe.decode(new Int16Array([1, 2]));
  const rejected = assert.rejects(pending, /lag/);
  context.mock.timers.tick(8000);
  await rejected;
  assert.deepEqual(reasons, ['recogniser lag']);
});
