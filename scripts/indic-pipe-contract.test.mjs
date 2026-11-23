import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openIndicPipe } from '../src/main/speech/indic-pipe.ts';
test('a missing helper never reports ready', async () => {
  await assert.rejects(openIndicPipe({ program: '/missing-drashti-test-helper', language: 'gu', files: { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' } }));
});
