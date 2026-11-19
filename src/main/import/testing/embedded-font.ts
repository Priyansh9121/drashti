import { inflateSync } from 'node:zlib';

/*
 * Tests only (h-run6, Session 59, PowerPoint run 6): a font embedded in a test deck as PowerPoint embeds one, so that
 * real PowerPoint draws Drashti's own bundled fonts (Noto Sans and its Gujarati and Devanagari, SIL Open Font License
 * 1.1, installable embedding) without anything being installed on the computer: the font as Embedded OpenType (EOT,
 * W3C's submission of 2008), version 2.1, uncompressed and unencrypted, in a part of type application/x-fontdata, as
 * a presentation's embeddedFontLst names it. The font itself comes from the WOFF 1.0 file Drashti ships.
 */

interface Table {
  tag: string;
  data: Buffer;
  checksum: number;
}

/** An OpenType font from a WOFF 1.0 file: each table inflated, the table directory rebuilt (tables in tag order). */
export function sfntFromWoff(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x77_4f_46_46) throw new Error('Not a WOFF 1.0 font.');
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables: Table[] = [];
  for (let i = 0; i < count; i++) {
    const at = 44 + 20 * i;
    const tag = woff.toString('latin1', at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const packed = woff.readUInt32BE(at + 8);
    const length = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + packed);
    const data = packed < length ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== length) throw new Error(`The WOFF table ${tag} did not inflate to its length.`);
    tables.push({ tag, data, checksum: woff.readUInt32BE(at + 16) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const power = 2 ** Math.floor(Math.log2(count));
  const head = Buffer.alloc(12 + 16 * count);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(count, 4);
  head.writeUInt16BE(power * 16, 6);
  head.writeUInt16BE(Math.log2(power), 8);
  head.writeUInt16BE(count * 16 - power * 16, 10);
  let offset = head.length;
  const bodies: Buffer[] = [];
  tables.forEach((table, i) => {
    head.write(table.tag, 12 + 16 * i, 'latin1');
    head.writeUInt32BE(table.checksum, 16 + 16 * i);
    head.writeUInt32BE(offset, 20 + 16 * i);
    head.writeUInt32BE(table.data.length, 24 + 16 * i);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([head, ...bodies]);
}

/** One table of an OpenType font, by its tag. */
function tableOf(font: Buffer, tag: string): Buffer {
  const count = font.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    if (font.toString('latin1', at, at + 4) === tag)
      return font.subarray(font.readUInt32BE(at + 8), font.readUInt32BE(at + 8) + font.readUInt32BE(at + 12));
  }
  throw new Error(`The font has no ${tag} table.`);
}

/** A name of the font (its Windows English record, UTF-16 big-endian), by its ID: 1 family, 2 style, 4 full, 5 version. */
export function fontName(font: Buffer, id: number): string {
  const names = tableOf(font, 'name');
  const count = names.readUInt16BE(2);
  const strings = names.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 6 + 12 * i;
    const [platform, encoding, language, nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((k) =>
      names.readUInt16BE(at + k),
    );
    if (platform === 3 && encoding === 1 && language === 0x409 && nameId === id)
      return Buffer.from(names.subarray(strings + (offset ?? 0), strings + (offset ?? 0) + (length ?? 0)))
        .swap16()
        .toString('utf16le');
  }
  throw new Error(`The font has no English name ${String(id)}.`);
}

/** The font's PANOSE classification (OS/2), as presentation.xml's p:font writes it: ten bytes in hex. */
export function fontPanose(font: Buffer): string {
  return tableOf(font, 'OS/2').subarray(32, 42).toString('hex').toUpperCase();
}

/** The font as Embedded OpenType 2.1 (EOT), uncompressed and unencrypted: PowerPoint's .fntdata. */
export function eotOf(font: Buffer): Buffer {
  const os2 = tableOf(font, 'OS/2');
  const head = tableOf(font, 'head');
  const utf16 = (text: string) => Buffer.from(text, 'utf16le');
  const named = [1, 2, 5, 4].map((id) => utf16(fontName(font, id)));
  const fixed = Buffer.alloc(82);
  fixed.writeUInt32LE(0x0002_0001, 8);
  fixed.writeUInt32LE(0, 12);
  os2.copy(fixed, 16, 32, 42);
  fixed.writeUInt8(1, 26);
  fixed.writeUInt8(os2.readUInt16BE(62) & 1, 27);
  fixed.writeUInt32LE(os2.readUInt16BE(4), 28);
  fixed.writeUInt16LE(os2.readUInt16BE(8), 32);
  fixed.writeUInt16LE(0x504c, 34);
  for (let i = 0; i < 4; i++) fixed.writeUInt32LE(os2.readUInt32BE(42 + 4 * i), 36 + 4 * i);
  // Code page ranges from OS/2 version 1 on.
  if (os2.length >= 86)
    for (let i = 0; i < 2; i++) fixed.writeUInt32LE(os2.readUInt32BE(78 + 4 * i), 52 + 4 * i);
  fixed.writeUInt32LE(head.readUInt32BE(8), 60);
  const sized = (bytes: Buffer) => {
    const out = Buffer.alloc(4 + bytes.length);
    out.writeUInt16LE(bytes.length, 2);
    bytes.copy(out, 4);
    return out;
  };
  // Padding1 is the last two bytes of `fixed`, before the family name's size; each other name has its own padding.
  const strings = Buffer.concat([
    ...named.map((bytes, i) => (i === 0 ? sized(bytes).subarray(2) : sized(bytes))),
    Buffer.alloc(4),
  ]);
  const eot = Buffer.concat([fixed, strings, font]);
  eot.writeUInt32LE(eot.length, 0);
  eot.writeUInt32LE(font.length, 4);
  return eot;
}
