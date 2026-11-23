import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { openIndicPipe } from '../src/main/speech/indic-pipe.ts';
test('native model load is admitted only after priority is established', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {}, pid: 1 });
  let prioritised = false;
  const writes = [];
  child.stdin.on('data', (data) => { assert.equal(prioritised, true); writes.push(data); });
  const opening = openIndicPipe({ program: '/fake', language: 'gu', files: { model: '/model', tokens: '/tokens', frontend: '/frontend' }, spawn: () => child, priority: () => { prioritised = true; } });
  child.stdout.emit('data', Buffer.from('{"ready":true}\n'));
  const pipe = await opening;
  try { assert.deepEqual(writes, [Buffer.from('GO01')]); } finally { pipe.close(); }
});
