import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndicEngine } from '../src/main/speech/indic-engine.ts';
test('unselected language cannot acquire a model or open sound', () => {
  let acquired = false, opened = false, state;
  const engine = createIndicEngine({ program: () => '/native', acquire: () => { acquired = true; return null; }, sound: { open: () => { opened = true; return null; } }, log: { info() {}, warn() {} } });
  engine.start('auto', { heard() {}, state: (s) => { state = s; } })();
  assert.equal(acquired, false); assert.equal(opened, false); assert.equal(state.phase, 'failed');
});
