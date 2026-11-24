import { expect, it } from 'vitest';
import { importProgressText } from './import-status-text';

const run = { runId: 'r', done: 0, total: 1, current: 'Placeholder large.png' };

it('says an import or a new picture is waiting for the screens’ transitions to finish (QA22-L8-1, the owner: "Keep wait, say why")', () => {
  expect(importProgressText({ ...run, phase: 'queued', current: null, waitingFor: 'transitions' })).toBe(
    'Waiting for the screens’ transitions to finish',
  );
  expect(importProgressText({ ...run, phase: 'importing', waitingFor: 'transitions' })).toBe(
    'Waiting for the screens’ transitions to finish · Placeholder large.png',
  );
});

it('says what an import does when nothing holds it, as before', () => {
  expect(importProgressText({ ...run, phase: 'queued', current: null })).toBe('Waiting to import…');
  expect(importProgressText({ ...run, phase: 'scanning', current: null })).toBe('Looking for files…');
  expect(importProgressText({ ...run, phase: 'importing' })).toBe('Importing 0 of 1 · Placeholder large.png');
});
