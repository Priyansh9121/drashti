// Drashti's icon files (Session 19): reading a Mac .icns, reading and writing a Windows .ico, the icons a
// Windows program (.exe) carries, and a PNG's size. scripts/make-icons.mjs makes the icons with these,
// scripts/check-installers.mjs checks what the installers carry, and src/main/windows/app-icon.test.ts
// checks the files in build/.
import { closeSync, openSync, readSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** A PNG's width and height, from its header; null when the bytes are not a PNG. */
export function pngSize(bytes) {
  if (
    bytes.length < 24 ||
    bytes.readUInt32BE(0) !== 0x89504e47 ||
    bytes.toString('latin1', 12, 16) !== 'IHDR'
  )
    return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * A PNG's pixels as straight RGBA, for the 8-bit, non-interlaced RGB and RGBA pictures Chromium writes
 * (what scripts/make-icons.mjs makes). Anything else throws.
 */
export function pngPixels(bytes) {
  const size = pngSize(bytes);
  if (!size) throw new Error('not a PNG');
  const { width, height } = size;
  const [depth, colour, , , interlace] = bytes.subarray(24, 29);
  const channels = { 2: 3, 6: 4 }[colour];
  if (depth !== 8 || !channels || interlace !== 0) throw new Error('only 8-bit RGB or RGBA PNGs are read');
  const data = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT')
      data.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      // Paeth: whichever of left, up and the corner is nearest left + up - corner (ties in that order).
      const [l, u, c] = [left, up, corner].map((v) => Math.abs(left + up - corner - v));
      const paeth = l <= u && l <= c ? left : u <= c ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      if (predicted === undefined) throw new Error(`a PNG row with filter ${String(filter)}`);
      rows[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0; i < width * height; i++) rows.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { width, height, rgba };
}

/** The pixel size of each kind of picture an .icns holds (Apple's types; iconutil writes ic04 to ic14). */
export const ICNS_TYPES = {
  ic04: 16, // 16 x 16
  ic11: 32, // 16 x 16 on a Retina screen
  ic05: 32, // 32 x 32
  ic12: 64, // 32 x 32 on a Retina screen
  ic07: 128,
  ic13: 256, // 128 x 128 on a Retina screen
  ic08: 256,
  ic14: 512, // 256 x 256 on a Retina screen
  ic09: 512,
  ic10: 1024, // 512 x 512 on a Retina screen
};

/** The entries of an .icns: each one's type, its size in pixels (when known) and its bytes. */
export function icnsEntries(bytes) {
  if (bytes.length < 8 || bytes.toString('latin1', 0, 4) !== 'icns' || bytes.readUInt32BE(4) !== bytes.length)
    throw new Error('not an .icns file');
  const out = [];
  for (let at = 8; at < bytes.length;) {
    const type = bytes.toString('latin1', at, at + 4);
    const length = at + 8 <= bytes.length ? bytes.readUInt32BE(at + 4) : 0;
    if (length < 8 || at + length > bytes.length) throw new Error(`a broken .icns entry (${type})`);
    const data = bytes.subarray(at + 8, at + length);
    const png = pngSize(data);
    out.push({ type, size: png ? png.width : (ICNS_TYPES[type] ?? null), png: png !== null, data });
    at += length;
  }
  return out;
}

/** The pictures of an .ico: each one's width, height, colour depth, whether it is a PNG, and its bytes. */
export function icoEntries(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1)
    throw new Error('not an .ico file');
  const out = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    const length = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    if (offset + length > bytes.length) throw new Error('a broken .ico entry');
    const data = bytes.subarray(offset, offset + length);
    out.push({
      width: bytes[at] || 256,
      height: bytes[at + 1] || 256,
      bits: bytes.readUInt16LE(at + 6),
      png: pngSize(data) !== null,
      data,
    });
  }
  return out;
}

/**
 * An .ico from pictures of each size: [{ size, rgba }] with straight (not premultiplied) RGBA pixels, and
 * { size: 256, png } for the largest. Sizes under 256 are stored as 32-bit bitmaps, which every part of
 * Windows reads (the installer's tools included); 256 as a PNG, as Windows' own icons are.
 */
export function writeIco(pictures) {
  const images = pictures.map(({ size, rgba, png }) => {
    if (png) return { size, data: png };
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8); // the picture and its mask
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const maskRow = Math.ceil(size / 32) * 4;
    header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
    const pixels = Buffer.alloc(size * size * 4);
    const mask = Buffer.alloc(maskRow * size);
    for (let y = 0; y < size; y++) {
      const row = size - 1 - y; // bitmaps are stored bottom up
      for (let x = 0; x < size; x++) {
        const from = (y * size + x) * 4;
        const to = (row * size + x) * 4;
        pixels[to] = rgba[from + 2];
        pixels[to + 1] = rgba[from + 1];
        pixels[to + 2] = rgba[from];
        pixels[to + 3] = rgba[from + 3];
        if (rgba[from + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { size, data: Buffer.concat([header, pixels, mask]) };
  });
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    directory[at] = size >= 256 ? 0 : size;
    directory[at + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

/**
 * The icon pictures a Windows program carries (its RT_ICON resources), each exactly as stored: rcedit and
 * NSIS copy an .ico's pictures into a program as they are. Only the headers and the resource section are
 * read, so a 200 MB program is no burden.
 */
export function programIcons(file) {
  const fd = openSync(file, 'r');
  try {
    const read = (position, length) => {
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, position);
      return buffer.subarray(0, got);
    };
    const head = read(0, 4096);
    const pe = head.readUInt32LE(0x3c);
    if (pe + 24 > head.length || head.toString('latin1', pe, pe + 4) !== 'PE\0\0')
      throw new Error('not a Windows program');
    const sections = head.readUInt16LE(pe + 6);
    const optional = pe + 24;
    const directories = optional + (head.readUInt16LE(optional) === 0x20b ? 112 : 96);
    const rsrcRva = head.readUInt32LE(directories + 2 * 8);
    const table = optional + head.readUInt16LE(pe + 20);
    let section = null;
    for (let i = 0; i < sections; i++) {
      const at = table + i * 40;
      const va = head.readUInt32LE(at + 12);
      const size = Math.max(head.readUInt32LE(at + 8), head.readUInt32LE(at + 16));
      if (rsrcRva >= va && rsrcRva < va + size)
        section = { va, raw: head.readUInt32LE(at + 20), size: head.readUInt32LE(at + 16) };
    }
    if (!section || rsrcRva === 0) return [];
    const rsrc = read(section.raw, section.size);
    const at = (rva) => rva - section.va; // an address in the program, as an offset into the section
    const root = at(rsrcRva);
    const entries = (directory) => {
      const d = root + directory;
      const count = rsrc.readUInt16LE(d + 12) + rsrc.readUInt16LE(d + 14);
      return Array.from({ length: count }, (_, i) => {
        const id = rsrc.readUInt32LE(d + 16 + i * 8);
        const to = rsrc.readUInt32LE(d + 20 + i * 8);
        return { id, directory: (to & 0x80000000) !== 0, offset: to & 0x7fffffff };
      });
    };
    const icons = entries(0).find((e) => e.id === 3 && e.directory); // RT_ICON
    if (!icons) return [];
    const out = [];
    for (const name of entries(icons.offset).filter((e) => e.directory))
      for (const language of entries(name.offset).filter((e) => !e.directory)) {
        const leaf = root + language.offset;
        const start = at(rsrc.readUInt32LE(leaf));
        out.push(Buffer.from(rsrc.subarray(start, start + rsrc.readUInt32LE(leaf + 4))));
      }
    return out;
  } finally {
    closeSync(fd);
  }
}

/** How many of an .ico's pictures a program carries exactly. */
export function carriedPictures(icoBytes, programPictures) {
  const pictures = icoEntries(icoBytes);
  return pictures.filter((p) => programPictures.some((q) => q.equals(p.data))).length;
}
