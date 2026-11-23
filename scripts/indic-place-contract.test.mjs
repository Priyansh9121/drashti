import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indicCandidates } from '../src/main/speech/indic-place.ts';
test('Windows packaged native recogniser uses Windows paths even when inspected on a Mac', () => {
  assert.deepEqual(indicCandidates({ packaged: true, resourcesPath: 'C:\\Drashti\\resources', appPath: 'C:\\work', platform: 'win32', arch: 'x64' }), ['C:\\Drashti\\resources\\indic\\ic-ctc.exe']);
});
