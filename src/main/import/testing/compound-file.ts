/* For tests only: never imported by the app. */

/**
 * A compound file (Office 97–2003's container) holding one stream of the given name and a summary: "PowerPoint
 * Document" makes a PowerPoint 97–2003 file as file-kind.ts reads one, "WordDocument" a Word one.
 */
export function compoundFile(stream: string): Buffer {
  const sector = 512;
  const header = Buffer.alloc(sector);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  // The directory starts at sector 1; no DIFAT sectors beyond the header's.
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(0xfffffffe, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(0xffffffff, 0x4c + i * 4);
  header.writeUInt32LE(0, 0x4c);
  // Sector 0: the FAT (itself, then the directory's one sector, its chain's end).
  const fat = Buffer.alloc(sector, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  // Sector 1: the directory.
  const directory = Buffer.alloc(sector);
  const entry = (at: number, name: string, type: number) => {
    const raw = Buffer.from(`${name}\0`, 'utf16le');
    raw.copy(directory, at);
    directory.writeUInt16LE(raw.length, at + 64);
    directory.writeUInt8(type, at + 66);
  };
  entry(0, 'Root Entry', 5);
  entry(128, stream, 2);
  entry(256, '\u0005SummaryInformation', 2);
  return Buffer.concat([header, fat, directory]);
}
