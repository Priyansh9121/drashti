import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { whatFileIs } from './file-kind';
import { compoundFile } from './testing/compound-file';
import { makeZip } from './testing/zip-writer';

/*
 * What a file is by its bytes, never its name (Session 54, D4): each file here is made of headers only, named as
 * something else, and only what is inside it counts.
 */

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-file-kind-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, bytes: Buffer | string) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};
const ftyp = (major: string, ...compatible: string[]) =>
  box('ftyp', Buffer.from(major, 'latin1'), u32(0), ...compatible.map((c) => Buffer.from(c, 'latin1')));
const trak = (handler: 'vide' | 'soun', codec: string) =>
  box(
    'trak',
    box(
      'mdia',
      box('hdlr', u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)),
      box('minf', box('stbl', box('stsd', u32(0), u32(1), box(codec, Buffer.alloc(16))))),
    ),
  );

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);

/** MPEG-1 Layer III frames at 128 kbit/s, 44.1 kHz: each 417 bytes, one after another. */
function mp3Frames(count: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/** A compound file (as Office 97–2003 writes them) whose directory names one stream after the root. */

describe('what a file is, by its bytes', () => {
  it('a picture, whatever it is called', async () => {
    expect(await whatFileIs(file('photo.png', JPEG))).toEqual({ kind: 'image', ext: 'jpg' });
    expect(await whatFileIs(file('IMG_0001', PNG))).toEqual({ kind: 'image', ext: 'png' });
    const heic = Buffer.concat([ftyp('heic', 'mif1', 'heic'), Buffer.alloc(64)]);
    expect(await whatFileIs(file('photo.jpg', heic))).toEqual({ kind: 'image', ext: 'heic' });
  });

  it('a video or a sound, by its tracks and the brand it names itself by', async () => {
    const mp4 = Buffer.concat([
      ftyp('isom', 'isom', 'avc1'),
      box('moov', trak('vide', 'avc1'), trak('soun', 'mp4a')),
    ]);
    expect(await whatFileIs(file('clip.pdf', mp4))).toEqual({ kind: 'video', ext: 'mp4' });
    const mov = Buffer.concat([ftyp('qt  ', 'qt  '), box('moov', trak('vide', 'hvc1'))]);
    expect(await whatFileIs(file('clip', mov))).toEqual({ kind: 'video', ext: 'mov' });
    const m4a = Buffer.concat([ftyp('M4A ', 'M4A ', 'mp42'), box('moov', trak('soun', 'mp4a'))]);
    expect(await whatFileIs(file('voice.mp4', m4a))).toEqual({ kind: 'audio', ext: 'm4a' });
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVEfmt '),
      Buffer.from([16, 0, 0, 0, 1, 0]),
      Buffer.alloc(14),
    ]);
    expect(await whatFileIs(file('tone.mp3', wav))).toEqual({ kind: 'audio', ext: 'wav' });
  });

  it('an MP3 with a tag, or as frames one after another; two bytes alone are not one', async () => {
    const tagged = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300)]);
    expect(await whatFileIs(file('a.bin', tagged))).toEqual({ kind: 'audio', ext: 'mp3' });
    expect(await whatFileIs(file('b.bin', mp3Frames(3)))).toEqual({ kind: 'audio', ext: 'mp3' });
    const lookalike = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(2000, 0x41)]);
    expect(await whatFileIs(file('song.mp3', lookalike))).toBeNull();
  });

  it('a PDF, with its header and its end', async () => {
    const pdf = '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';
    expect(await whatFileIs(file('notes.jpg', pdf))).toEqual({ kind: 'pdf', ext: 'pdf' });
    expect(await whatFileIs(file('cut.pdf', '%PDF-1.7\n1 0 obj << /Type /Catalog >>'))).toBeNull();
  });

  it('a PowerPoint or Keynote file by the parts inside it; a Word file or another zip is not one', async () => {
    const pptx = makeZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
    ]);
    expect(await whatFileIs(file('slides.zip', pptx))).toEqual({ kind: 'powerpoint', ext: 'pptx' });
    const key = makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(32) }]);
    expect(await whatFileIs(file('slides.pptx', key))).toEqual({ kind: 'keynote', ext: 'key' });
    const docx = makeZip([{ name: 'word/document.xml', data: '<w:document/>' }]);
    expect(await whatFileIs(file('renamed.pptx', docx))).toBeNull();
    const photos = makeZip([{ name: 'photo.jpg', data: JPEG }]);
    expect(await whatFileIs(file('photos.key', photos))).toBeNull();
  });

  it('a PowerPoint 97–2003 file names its PowerPoint Document; a Word 97–2003 file does not', async () => {
    expect(await whatFileIs(file('old.doc', compoundFile('PowerPoint Document')))).toEqual({
      kind: 'powerpoint',
      ext: 'ppt',
    });
    expect(await whatFileIs(file('old.ppt', compoundFile('WordDocument')))).toBeNull();
  });

  it('a program, a page of text or nothing at all, named as media, is none of them', async () => {
    const program = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(510, 0x90)]);
    expect(await whatFileIs(file('video.mp4', program))).toBeNull();
    expect(await whatFileIs(file('photo.jpg', 'Placeholder words, not a picture.\n'))).toBeNull();
    expect(await whatFileIs(file('empty.png', ''))).toBeNull();
    const script = Buffer.from('#!/bin/sh\necho placeholder\n');
    expect(await whatFileIs(file('song.mp3', script))).toBeNull();
    expect(await whatFileIs(join(dir, 'not-there.jpg'))).toBeNull();
  });
});
