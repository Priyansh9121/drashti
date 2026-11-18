export interface OscArgument {
  type: string;
  value: number | string | bigint | boolean | null | Buffer | OscArgument[];
}

export interface OscMessage {
  address: string;
  arguments: OscArgument[];
  timetag: bigint;
}

export const OSC_LIMITS = {
  bytes: 16_384,
  depth: 8,
  messages: 32,
  arguments: 64,
  totalArguments: 256,
} as const;

/** A cursor cannot read or search past this bundle element, even inside a larger datagram. */
class Cursor {
  at: number;

  constructor(
    readonly bytes: Buffer,
    start: number,
    readonly end: number,
  ) {
    this.at = start;
  }

  need(size: number): number {
    if (size < 0 || size > this.end - this.at) throw new Error('Truncated OSC');
    const at = this.at;
    this.at += size;
    return at;
  }

  padding(length: number): void {
    const size = (4 - (length % 4)) % 4;
    const at = this.need(size);
    for (let i = at; i < at + size; i++) {
      if (this.bytes[i] !== 0) throw new Error('Nonzero OSC padding');
    }
  }

  string(): string {
    const start = this.at;
    while (this.at < this.end && this.bytes[this.at] !== 0) {
      if ((this.bytes[this.at] ?? 128) > 127) throw new Error('Non-ASCII OSC string');
      this.at++;
    }
    this.need(1);
    const value = this.bytes.toString('ascii', start, this.at - 1);
    this.padding(this.at - start);
    return value;
  }

  int(): number {
    return this.bytes.readInt32BE(this.need(4));
  }

  time(): bigint {
    return this.bytes.readBigUInt64BE(this.need(8));
  }
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Non-finite OSC number');
  return value;
}

/** Read one untrusted datagram; a bad packet has no partial result. */
export function readOsc(packet: Uint8Array): OscMessage[] | null {
  if (packet.length === 0 || packet.length > OSC_LIMITS.bytes || packet.length % 4 !== 0) return null;
  const bytes = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
  const messages: OscMessage[] = [];
  let totalArguments = 0;
  try {
    const read = (start: number, end: number, depth: number, parentTime: bigint): void => {
      if (depth > OSC_LIMITS.depth || end <= start || (end - start) % 4 !== 0) throw new Error('OSC bounds');
      const cursor = new Cursor(bytes, start, end);
      const address = cursor.string();
      if (address === '#bundle') {
        const timetag = cursor.time();
        if (parentTime !== 1n && timetag < parentTime) throw new Error('OSC bundle time order');
        while (cursor.at < end) {
          const length = cursor.int();
          const at = cursor.need(length);
          read(at, at + length, depth + 1, timetag);
        }
        return;
      }
      if (!/^\/[\x21-\x7e]*$/u.test(address) || messages.length >= OSC_LIMITS.messages)
        throw new Error('OSC address or message budget');
      const tags = cursor.string();
      if (!tags.startsWith(',') || tags.length > OSC_LIMITS.arguments * 3 + 1)
        throw new Error('OSC type tags');
      let position = 1;
      let count = 0;
      const args = (arrayDepth: number): OscArgument[] => {
        if (arrayDepth > OSC_LIMITS.depth) throw new Error('OSC array depth');
        const values: OscArgument[] = [];
        while (position < tags.length) {
          const type = tags[position++] ?? '';
          if (type === ']') {
            if (arrayDepth === 0) throw new Error('Unexpected OSC array end');
            return values;
          }
          if (++count > OSC_LIMITS.arguments || ++totalArguments > OSC_LIMITS.totalArguments)
            throw new Error('OSC argument budget');
          let value: OscArgument['value'];
          switch (type) {
            case 'i':
              value = cursor.int();
              break;
            case 'f':
              value = finite(bytes.readFloatBE(cursor.need(4)));
              break;
            case 's':
            case 'S':
              value = cursor.string();
              break;
            case 'b': {
              const length = cursor.int();
              const at = cursor.need(length);
              value = Buffer.from(bytes.subarray(at, at + length));
              cursor.padding(length);
              break;
            }
            case 'h':
              value = bytes.readBigInt64BE(cursor.need(8));
              break;
            case 't':
              value = cursor.time();
              break;
            case 'd':
              value = finite(bytes.readDoubleBE(cursor.need(8)));
              break;
            case 'c': {
              const code = cursor.int();
              if (code < 0 || code > 127) throw new Error('Non-ASCII OSC character');
              value = String.fromCharCode(code);
              break;
            }
            case 'r':
              value = bytes.readUInt32BE(cursor.need(4));
              break;
            case 'm': {
              const at = cursor.need(4);
              value = Buffer.from(bytes.subarray(at, at + 4));
              break;
            }
            case 'T':
              value = true;
              break;
            case 'F':
              value = false;
              break;
            case 'N':
              value = null;
              break;
            case 'I':
              value = Infinity;
              break;
            case '[':
              value = args(arrayDepth + 1);
              break;
            default:
              throw new Error('Unknown OSC type');
          }
          values.push({ type, value });
        }
        if (arrayDepth > 0) throw new Error('Unclosed OSC array');
        return values;
      };
      const arguments_ = args(0);
      if (cursor.at !== end) throw new Error('Trailing OSC data');
      messages.push({ address, arguments: arguments_, timetag: parentTime });
    };
    read(0, bytes.length, 0, 1n);
    return messages;
  } catch {
    return null;
  }
}
