import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indicCandidates, indicProblem } from '../src/main/speech/indic-place.ts';
test('Windows packaged native recogniser uses Windows paths even when inspected on a Mac', () => {
  assert.deepEqual(
    indicCandidates({
      packaged: true,
      resourcesPath: 'C:\\Drashti\\resources',
      appPath: 'C:\\work',
      platform: 'win32',
      arch: 'x64',
    }),
    ['C:\\Drashti\\resources\\indic\\ic-ctc.exe'],
  );
});

test('Route C declares the runtime’s actual macOS 13.4 minimum', () => {
  assert.equal(indicProblem('darwin', '13.4'), null);
  assert.equal(indicProblem('win32', '10.0'), null);
  assert.match(indicProblem('darwin', '13.3.1'), /13.4/);
});
