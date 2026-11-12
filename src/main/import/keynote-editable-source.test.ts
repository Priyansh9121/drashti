import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertToPdf } from './deck-converters';
import { makeTestPdf } from './testing/make-pdf';
import { makeTestPptx } from './testing/make-pptx';
import { makeZip } from './testing/zip-writer';

const spawn = vi.hoisted(() => vi.fn<(command: string, args: string[]) => EventEmitter>());
vi.mock('node:child_process', () => ({ spawn }));

const slides = [
  { color: '204060', text: 'Placeholder first', notes: 'Placeholder first note' },
  {
    color: '305020',
    text: 'Placeholder hidden',
    notes: 'Placeholder hidden note',
    hidden: true,
    animated: true,
  },
  { color: '503020', text: 'Placeholder last', notes: 'Placeholder last note' },
];
const source = makeZip([{ name: 'Index/Document.iwa', data: 'Placeholder Keynote index' }]);
const pptx = makeTestPptx(slides);
const pdf = makeTestPdf([
  { width: 960, height: 540, color: [32, 64, 96], text: 'Placeholder first' },
  { width: 960, height: 540, color: [80, 48, 32], text: 'Placeholder last' },
]);
const shownNotes = 'Placeholder first note\u001ePlaceholder last note';

function child(code = 0, output = '', error = '') {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  queueMicrotask(() => {
    stdout.emit('data', Buffer.from(output));
    stderr.emit('data', Buffer.from(error));
    emitter.emit('exit', code);
  });
  return Object.assign(emitter, { stdout, stderr, kill: () => emitter.emit('exit', null) });
}

/** Exercise the real session's private copy and cleanup, with every subprocess stood in. */
function standInKeynote(exported: 'good' | 'corrupt' | 'timed out') {
  spawn.mockImplementation((command, args) => {
    if (command === 'pgrep') return child(0, '12345\n');
    if (command === 'lsappinfo' || command === 'open') return child();
    if (command !== 'osascript') throw new Error('Unexpected subprocess: ' + command);
    if (args.some((arg) => arg.includes('to return version'))) return child(0, 'Placeholder version');
    if (args.some((arg) => arg.includes('then return (id of d)')))
      return child(0, 'Placeholder document ID\n3');

    const pdfPath = args.find((arg) => extname(arg) === '.pdf');
    if (pdfPath) writeFileSync(pdfPath, pdf);
    const pptxPath = args.find((arg) => extname(arg) === '.pptx');
    if (pptxPath) {
      if (exported === 'timed out') return child(1, '', 'Placeholder export timed out (-1712)');
      writeFileSync(pptxPath, exported === 'good' ? pptx : 'Placeholder damaged PowerPoint export');
    }
    if (pdfPath || pptxPath) return child(0, pdfPath ? shownNotes : '');
    if (args.some((arg) => arg.includes('file of document id') || arg.startsWith('close (document id')))
      return child();
    throw new Error('Unexpected AppleScript stand-in call.');
  });
}

describe('the editable Keynote export', () => {
  let work: string;
  let input: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'drashti-keynote-source-'));
    input = join(work, 'Placeholder presentation.key');
    writeFileSync(input, source);
  });

  afterEach(() => {
    spawn.mockReset();
    rmSync(work, { recursive: true, force: true });
  });

  it('returns a PowerPoint file that survives cleanup and keeps hidden slides in source order', async () => {
    standInKeynote('good');

    const result = await convertToPdf('keynote', input, work, { platform: 'darwin' });

    expect(result).toMatchObject({ ok: true, editablePptx: expect.any(String) });
    if (!result.ok || !('editablePptx' in result) || typeof result.editablePptx !== 'string')
      throw new Error('Missing editable Keynote export.');
    expect(dirname(result.editablePptx)).toBe(work);
    expect(extname(result.editablePptx)).toBe('.pptx');
    expect(readFileSync(result.editablePptx)).toEqual(pptx);
    expect(readFileSync(result.pdf)).toEqual(pdf);
    expect(result.shownOnly).toBe(false);
    expect(result.slides?.map(({ notes, hidden, animated }) => [notes, hidden, animated])).toEqual([
      ['Placeholder first note', false, false],
      ['Placeholder hidden note', true, true],
      ['Placeholder last note', false, false],
    ]);
    expect(readdirSync(work).some((name) => name.startsWith('convert-'))).toBe(false);
    expect(readFileSync(input)).toEqual(source);
  });

  it.each(['corrupt', 'timed out'] as const)('keeps the PDF if the editable export is %s', async (exported) => {
    standInKeynote(exported);

    const result = await convertToPdf('keynote', input, work, { platform: 'darwin' });

    expect(result).toMatchObject({ ok: true, shownOnly: true });
    if (!result.ok) throw new Error('Missing PDF fallback.');
    expect(result).not.toHaveProperty('editablePptx');
    expect(readFileSync(result.pdf)).toEqual(pdf);
    expect(result.slides?.map(({ notes }) => notes)).toEqual(shownNotes.split('\u001e'));
    expect(readdirSync(work).some((name) => name.startsWith('convert-'))).toBe(false);
  });
});
