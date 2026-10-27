import { open } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';
import { withZip, ZipError } from '../zip';

/*
 * A copy of a zip with some of its entries' contents replaced (Session 54, C2: a deck's timed copy, ./timed-copy.ts).
 * Every other entry is copied as it is stored, compressed bytes and all, never inflated: a deck's videos go across
 * in a moment. The copy has no ZIP64 (a deck Drashti bakes is under 1 GB) and no data descriptors.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const MAX32 = 0xffffffff;
/** Bit 11: the name is UTF-8. */
const UTF8 = 0x800;

export async function copyZipReplacing(
  input: string,
  output: string,
  replace: ReadonlyMap<string, Buffer>,
): Promise<void> {
  await withZip(input, async (entries, source) => {
    const out = await open(output, 'w');
    try {
      let at = 0;
      const write = async (buf: Buffer) => {
        await out.write(buf, 0, buf.length, at);
        at += buf.length;
      };
      const centrals: Buffer[] = [];
      for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const offset = at;
        const fresh = replace.get(entry.name);
        let method = entry.method;
        let crc = entry.crc;
        let size = entry.size;
        let body: Buffer | null = null;
        let compressed = entry.compressedSize;
        if (fresh) {
          body = deflateRawSync(fresh);
          method = 8;
          crc = crc32(fresh);
          size = fresh.length;
          compressed = body.length;
        }
        if (offset > MAX32 || size > MAX32 || compressed > MAX32)
          throw new ZipError('The deck is too big to copy (over 4 GB).');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(UTF8, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc >>> 0, 14);
        local.writeUInt32LE(compressed, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.length, 26);
        await write(local);
        await write(name);
        if (body) await write(body);
        else if (compressed > 0) {
          // As it is stored: from the source's local header on, its compressed bytes.
          const head = Buffer.alloc(30);
          await source.read(head, 0, 30, entry.offset);
          if (head.readUInt32LE(0) !== LOCAL) throw new ZipError(`Broken entry ${entry.name}.`);
          let from = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
          const chunk = Buffer.alloc(Math.min(compressed, 1024 * 1024));
          for (let left = compressed; left > 0;) {
            const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, left), from);
            if (bytesRead === 0) throw new ZipError('The deck ends early.');
            await write(chunk.subarray(0, bytesRead));
            from += bytesRead;
            left -= bytesRead;
          }
        }
        const central = Buffer.alloc(46);
        central.writeUInt32LE(CENTRAL, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(UTF8, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(crc >>> 0, 16);
        central.writeUInt32LE(compressed, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
      }
      const cd = Buffer.concat(centrals);
      const start = at;
      if (start > MAX32 || entries.length > 0xffff) throw new ZipError('The deck is too big to copy.');
      await write(cd);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(EOCD, 0);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(cd.length, 12);
      end.writeUInt32LE(start, 16);
      await write(end);
    } finally {
      await out.close();
    }
  });
}
