import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeIndicFixture } from './indic-fixture.mjs';

test('generated neutral ONNX fixture has model, 257 tokens and fixed frontend dimensions', () => {
  const f = makeIndicFixture();
  assert.ok(f.model.length > 100);
  assert.ok(f.model.length < 16384);
  assert.equal(f.tokens.trimEnd().split('\n').length, 257);
  assert.equal(f.tokens.trimEnd().split('\n').at(-1), '<blank>');
  assert.equal(f.frontend.length, 80 * 257 * 4);
  assert.ok(f.tokens.includes('▁shape'));
});
