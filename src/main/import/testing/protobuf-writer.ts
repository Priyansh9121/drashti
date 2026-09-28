import type { Descriptor, FieldDesc, UnknownField } from '../protobuf';

/*
 * For tests only: encodes plain objects as Protocol Buffers with the same
 * field table the importer decodes with, so tests can build ProPresenter 7
 * files full of placeholder content. Never imported by the app.
 */

class Writer {
  private chunks: Uint8Array[] = [];

  varint(value: number | bigint): void {
    let v = BigInt.asUintN(64, BigInt(value));
    const out: number[] = [];
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v !== 0n) b |= 0x80;
      out.push(b);
    } while (v !== 0n);
    this.chunks.push(Uint8Array.from(out));
  }

  tag(field: number, wire: number): void {
    this.varint((field << 3) | wire);
  }

  raw(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  lengthDelimited(bytes: Uint8Array): void {
    this.varint(bytes.length);
    this.raw(bytes);
  }

  fixed(size: 4 | 8, write: (view: DataView) => void): void {
    const buf = new Uint8Array(size);
    write(new DataView(buf.buffer));
    this.raw(buf);
  }

  finish(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

const VARINT = new Set(['bool', 'uint32', 'int32', 'sint32', 'uint64', 'int64', 'sint64']);
const FIXED32 = new Set(['fixed32', 'sfixed32', 'float']);
const FIXED64 = new Set(['fixed64', 'sfixed64', 'double']);

function writeScalar(w: Writer, field: number, type: string, kind: FieldDesc['kind'], value: unknown): void {
  if (kind === 'enum' || VARINT.has(type)) {
    w.tag(field, 0);
    let n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (type === 'sint32' || type === 'sint64') n = n >= 0 ? n * 2 : -n * 2 - 1;
    w.varint(n);
  } else if (FIXED32.has(type)) {
    w.tag(field, 5);
    w.fixed(4, (v) => {
      if (type === 'float') v.setFloat32(0, Number(value), true);
      else if (type === 'sfixed32') v.setInt32(0, Number(value), true);
      else v.setUint32(0, Number(value), true);
    });
  } else if (FIXED64.has(type)) {
    w.tag(field, 1);
    w.fixed(8, (v) => {
      if (type === 'double') v.setFloat64(0, Number(value), true);
      else v.setBigUint64(0, BigInt.asUintN(64, BigInt(Number(value))), true);
    });
  } else {
    w.tag(field, 2);
    w.lengthDelimited(typeof value === 'string' ? new TextEncoder().encode(value) : (value as Uint8Array));
  }
}

export function encodeMessage(
  obj: Record<string, unknown>,
  type: string,
  d: Descriptor,
  options: { packed?: boolean } = {},
): Uint8Array {
  const fields = d.messages[type];
  if (!fields) throw new Error(`No definition for ${type}`);
  const byName = new Map(Object.entries(fields).map(([n, f]) => [f.name, { number: Number(n), f }]));
  const w = new Writer();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (key === '$unknown') {
      for (const u of value as UnknownField[]) {
        w.tag(u.field, u.wireType);
        if (u.wireType === 0) w.varint(u.value as number);
        else if (u.wireType === 2) w.lengthDelimited(u.value as Uint8Array);
        else w.raw(u.value as Uint8Array);
      }
      continue;
    }
    const entry = byName.get(key);
    if (!entry) throw new Error(`${type} has no field ${key}`);
    const { number, f } = entry;
    const values = f.repeated ? (value as unknown[]) : [value];
    if (f.kind === 'map') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const e = new Writer();
        writeScalar(e, 1, f.key ?? 'string', 'scalar', f.key === 'string' ? k : Number(k));
        if (f.value === 'message') {
          e.tag(2, 2);
          e.lengthDelimited(encodeMessage(v as Record<string, unknown>, f.type, d, options));
        } else writeScalar(e, 2, f.type, f.value === 'enum' ? 'enum' : 'scalar', v);
        w.tag(number, 2);
        w.lengthDelimited(e.finish());
      }
    } else if (f.kind === 'message') {
      for (const v of values) {
        w.tag(number, 2);
        w.lengthDelimited(encodeMessage(v as Record<string, unknown>, f.type, d, options));
      }
    } else if (options.packed && f.repeated && f.type !== 'string' && f.type !== 'bytes') {
      const p = new Writer();
      for (const v of values) {
        const one = new Writer();
        writeScalar(one, 1, f.type, f.kind, v);
        // Drop the per-value tag: packed values follow one another.
        const bytes = one.finish();
        p.raw(bytes.subarray(1));
      }
      w.tag(number, 2);
      w.lengthDelimited(p.finish());
    } else {
      for (const v of values) writeScalar(w, number, f.type, f.kind, v);
    }
  }
  return w.finish();
}
