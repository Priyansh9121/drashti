import { crc32, deflateRawSync } from 'node:zlib';

/* For tests only: never imported by the app. */

/** A minimal ZIP writer for the tests (stored or deflated entries). */
export function makeZip(
  entries: {
    name: string;
    data: string | Buffer;
    deflate?: boolean;
    utf8?: boolean;
    /** A Unix file mode (e.g. 0o120777, a symbolic link), as zip on a Mac or Linux writes it. */
    unixMode?: number;
  }[],
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, e.utf8 === false ? 'latin1' : 'utf8');
    const flags = e.utf8 === false ? 0 : 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    // With its CRC, so other programs (PowerPoint, Keynote) open it too.
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // Made by: version 2.0, on Unix (3) when it carries a Unix mode.
    central.writeUInt16LE(e.unixMode === undefined ? 20 : 0x0300 | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    if (e.unixMode !== undefined) central.writeUInt32LE((e.unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
