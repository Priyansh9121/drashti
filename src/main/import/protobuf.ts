import { TextDecoder } from 'node:util';

/*
 * A Protocol Buffers reader driven by a field table (generated from the
 * vendored ProPresenter 7 definitions by scripts/gen-pp7-descriptor.mjs).
 * Known fields become properties named as in the definitions. Fields the
 * table does not know (a newer version's additions) are kept in `$unknown`
 * with their raw values and counted, never dropped.
 */

export interface FieldDesc {
  name: string;
  kind: 'scalar' | 'message' | 'enum' | 'map';
  /** Scalar type (int32, string...), or a message or enum's full name. For maps: the value type. */
  type: string;
  repeated?: boolean;
  /** Maps: the key's scalar type, and what the value is. */
  key?: string;
  value?: 'scalar' | 'message' | 'enum';
}

export interface Descriptor {
  messages: Record<string, Record<string, FieldDesc>>;
}

export interface UnknownField {
  field: number;
  wireType: number;
  /** Varints as numbers; everything else as raw bytes. */
  value: number | Uint8Array;
}

export interface Message {
  [name: string]: unknown;
  $unknown?: UnknownField[];
}

export interface DecodeStats {
  /** Fields the table did not know, over the whole file. */
  unknown: number;
}

export class ProtobufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtobufError';
  }
}

const utf8 = new TextDecoder('utf-8');
const TWO32 = 2 ** 32;

class Reader {
  pos: number;

  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
  }

  private byte(): number {
    if (this.pos >= this.end) throw new ProtobufError('The data ends in the middle of a field.');
    return this.buf[this.pos++] ?? 0;
  }

  /** A varint as its low and high 32 bits (unsigned). */
  varint64(): { lo: number; hi: number } {
    let lo = 0;
    let hi = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      const b = this.byte();
      if (shift < 28) lo |= (b & 0x7f) << shift;
      else if (shift === 28) {
        lo |= (b & 0x0f) << 28;
        hi |= (b & 0x7f) >> 4;
      } else hi |= (b & 0x7f) << (shift - 32);
      if ((b & 0x80) === 0) return { lo: lo >>> 0, hi: hi >>> 0 };
    }
    throw new ProtobufError('A varint is too long.');
  }

  uint32(): number {
    return this.varint64().lo;
  }

  bytes(length: number): Uint8Array {
    if (length < 0 || this.pos + length > this.end)
      throw new ProtobufError('A field is longer than the data.');
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  fixed(size: 4 | 8): DataView {
    const b = this.bytes(size);
    return new DataView(b.buffer, b.byteOffset, size);
  }
}

const unsigned64 = (v: { lo: number; hi: number }) => v.hi * TWO32 + v.lo;
const signed64 = (v: { lo: number; hi: number }) =>
  v.hi & 0x80000000 ? -((~v.hi >>> 0) * TWO32 + (~v.lo >>> 0) + 1) : unsigned64(v);

function scalarFromVarint(type: string, v: { lo: number; hi: number }): number | boolean {
  switch (type) {
    case 'bool':
      return v.lo !== 0 || v.hi !== 0;
    case 'uint32':
      return v.lo;
    case 'int32':
      return v.lo | 0;
    case 'sint32':
      return (v.lo >>> 1) ^ -(v.lo & 1);
    case 'uint64':
      return unsigned64(v);
    case 'sint64': {
      const n = unsigned64(v);
      return v.lo & 1 ? -(n + 1) / 2 : n / 2;
    }
    default:
      // int64 and enums
      return type === 'int64' ? signed64(v) : v.lo | 0;
  }
}

const VARINT_TYPES = new Set(['bool', 'uint32', 'int32', 'sint32', 'uint64', 'int64', 'sint64']);
const FIXED32_TYPES = new Set(['fixed32', 'sfixed32', 'float']);
const FIXED64_TYPES = new Set(['fixed64', 'sfixed64', 'double']);

function readFixed(r: Reader, type: string): number {
  if (FIXED32_TYPES.has(type)) {
    const view = r.fixed(4);
    return type === 'float'
      ? view.getFloat32(0, true)
      : type === 'sfixed32'
        ? view.getInt32(0, true)
        : view.getUint32(0, true);
  }
  const view = r.fixed(8);
  if (type === 'double') return view.getFloat64(0, true);
  return Number(type === 'sfixed64' ? view.getBigInt64(0, true) : view.getBigUint64(0, true));
}

/** The wire type a field of this kind is written with (2 for anything length-delimited). */
function wireTypeOf(kind: FieldDesc['kind'], type: string): number {
  if (kind === 'message' || kind === 'map') return 2;
  if (kind === 'enum' || VARINT_TYPES.has(type)) return 0;
  if (FIXED32_TYPES.has(type)) return 5;
  if (FIXED64_TYPES.has(type)) return 1;
  return 2; // string, bytes
}

function readSingle(r: Reader, kind: 'scalar' | 'enum', type: string): unknown {
  const wire = wireTypeOf(kind, type);
  if (wire === 0) return scalarFromVarint(kind === 'enum' ? 'enum' : type, r.varint64());
  if (wire === 5 || wire === 1) return readFixed(r, type);
  const bytes = r.bytes(r.uint32());
  return type === 'string' ? utf8.decode(bytes) : bytes;
}

function skip(r: Reader, wire: number): number | Uint8Array {
  switch (wire) {
    case 0:
      return unsigned64(r.varint64());
    case 1:
      return r.bytes(8);
    case 2:
      return r.bytes(r.uint32());
    case 5:
      return r.bytes(4);
    default:
      throw new ProtobufError(`Wire type ${wire} is not supported.`);
  }
}

function decodeAt(r: Reader, type: string, d: Descriptor, stats?: DecodeStats): Message {
  const fields = d.messages[type];
  if (!fields) throw new ProtobufError(`No definition for ${type}.`);
  const out: Message = {};
  while (r.pos < r.end) {
    const key = r.uint32();
    const number = key >>> 3;
    const wire = key & 7;
    if (number === 0) throw new ProtobufError('Field number 0 is not valid.');
    const f = fields[number];
    const expected = f ? wireTypeOf(f.kind, f.type) : -1;
    const packable =
      f?.repeated === true && f.kind !== 'message' && f.kind !== 'map' && expected !== 2 && wire === 2;
    if (!f || (wire !== expected && !packable)) {
      const value = skip(r, wire);
      (out.$unknown ??= []).push({ field: number, wireType: wire, value });
      if (stats) stats.unknown++;
      continue;
    }
    if (f.kind === 'message') {
      const length = r.uint32();
      const sub = new Reader(r.buf, r.pos, r.pos + length);
      if (sub.end > r.end) throw new ProtobufError('A message is longer than the data.');
      r.pos = sub.end;
      const value = decodeAt(sub, f.type, d, stats);
      if (f.repeated) ((out[f.name] ??= []) as unknown[]).push(value);
      else out[f.name] = value;
    } else if (f.kind === 'map') {
      const length = r.uint32();
      const entry = new Reader(r.buf, r.pos, r.pos + length);
      r.pos = entry.end;
      let k: unknown = '';
      let v: unknown;
      while (entry.pos < entry.end) {
        const ek = entry.uint32();
        if (ek >>> 3 === 1) k = readSingle(entry, 'scalar', f.key ?? 'string');
        else if (ek >>> 3 === 2) {
          if (f.value === 'message') {
            const len = entry.uint32();
            const sub = new Reader(entry.buf, entry.pos, entry.pos + len);
            entry.pos = sub.end;
            v = decodeAt(sub, f.type, d, stats);
          } else v = readSingle(entry, f.value === 'enum' ? 'enum' : 'scalar', f.type);
        } else skip(entry, ek & 7);
      }
      ((out[f.name] ??= {}) as Record<string, unknown>)[String(k)] = v;
    } else if (packable) {
      const length = r.uint32();
      const packed = new Reader(r.buf, r.pos, r.pos + length);
      r.pos = packed.end;
      const list = (out[f.name] ??= []) as unknown[];
      while (packed.pos < packed.end) list.push(readSingle(packed, f.kind, f.type));
    } else {
      const value = readSingle(r, f.kind, f.type);
      if (f.repeated) ((out[f.name] ??= []) as unknown[]).push(value);
      else out[f.name] = value;
    }
  }
  return out;
}

/** Decode a message of `type` from its bytes. Throws ProtobufError on data that is not that message. */
export function decodeMessage(
  bytes: Uint8Array,
  type: string,
  descriptor: Descriptor,
  stats?: DecodeStats,
): Message {
  return decodeAt(new Reader(bytes), type, descriptor, stats);
}
