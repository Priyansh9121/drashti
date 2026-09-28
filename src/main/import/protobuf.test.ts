import { describe, expect, it } from 'vitest';
import { type Descriptor, decodeMessage, ProtobufError } from './protobuf';
import { encodeMessage } from './testing/protobuf-writer';

/** A small table in the generated shape, with each kind of field. */
const d: Descriptor = {
  messages: {
    'test.Doc': {
      '1': { name: 'name', kind: 'scalar', type: 'string' },
      '2': { name: 'count', kind: 'scalar', type: 'int32' },
      '3': { name: 'big', kind: 'scalar', type: 'uint64' },
      '4': { name: 'offset', kind: 'scalar', type: 'sint32' },
      '5': { name: 'ratio', kind: 'scalar', type: 'double' },
      '6': { name: 'alpha', kind: 'scalar', type: 'float' },
      '7': { name: 'on', kind: 'scalar', type: 'bool' },
      '8': { name: 'mode', kind: 'enum', type: 'test.Mode' },
      '9': { name: 'data', kind: 'scalar', type: 'bytes' },
      '10': { name: 'child', kind: 'message', type: 'test.Child' },
      '11': { name: 'children', kind: 'message', type: 'test.Child', repeated: true },
      '12': { name: 'numbers', kind: 'scalar', type: 'int32', repeated: true },
      '13': { name: 'labels', kind: 'map', type: 'string', key: 'string', value: 'scalar' },
      '14': { name: 'tags', kind: 'scalar', type: 'string', repeated: true },
    },
    'test.Child': {
      '1': { name: 'id', kind: 'scalar', type: 'string' },
      '2': { name: 'size', kind: 'scalar', type: 'double' },
    },
  },
};

describe('decodeMessage', () => {
  it('reads every kind of field', () => {
    const doc = {
      name: 'નમૂનો placeholder',
      count: -7,
      big: 2 ** 40 + 3,
      offset: -300,
      ratio: 1.25,
      alpha: 0.5,
      on: true,
      mode: 2,
      data: Uint8Array.from([1, 2, 3]),
      child: { id: 'c1', size: 16.5 },
      children: [{ id: 'a' }, { id: 'b', size: 2 }],
      numbers: [1, -2, 300],
      labels: { first: 'one', second: 'two' },
      tags: ['x', 'y'],
    };
    expect(decodeMessage(encodeMessage(doc, 'test.Doc', d), 'test.Doc', d)).toEqual(doc);
  });

  it('reads packed repeated numbers', () => {
    const bytes = encodeMessage({ numbers: [5, -1, 70000] }, 'test.Doc', d, { packed: true });
    expect(decodeMessage(bytes, 'test.Doc', d)).toEqual({ numbers: [5, -1, 70000] });
  });

  it('keeps fields it does not know, with their raw values, and counts them', () => {
    const bytes = encodeMessage(
      {
        name: 'kept',
        $unknown: [
          { field: 99, wireType: 0, value: 42 },
          { field: 100, wireType: 2, value: Uint8Array.from([7, 8]) },
        ],
        child: { id: 'c', $unknown: [{ field: 50, wireType: 5, value: Uint8Array.from([0, 0, 128, 63]) }] },
      },
      'test.Doc',
      d,
    );
    const stats = { unknown: 0 };
    const out = decodeMessage(bytes, 'test.Doc', d, stats);
    expect(out['name']).toBe('kept');
    expect(out.$unknown).toEqual([
      { field: 99, wireType: 0, value: 42 },
      { field: 100, wireType: 2, value: Uint8Array.from([7, 8]) },
    ]);
    expect((out['child'] as { $unknown: unknown[] }).$unknown).toEqual([
      { field: 50, wireType: 5, value: Uint8Array.from([0, 0, 128, 63]) },
    ]);
    expect(stats.unknown).toBe(3);
  });

  it('keeps a known field written with an unexpected wire type as unknown, rather than misreading it', () => {
    // Field 1 (name, a string) written as a varint.
    const stats = { unknown: 0 };
    const out = decodeMessage(Uint8Array.from([0x08, 0x05]), 'test.Doc', d, stats);
    expect(out).toEqual({ $unknown: [{ field: 1, wireType: 0, value: 5 }] });
    expect(stats.unknown).toBe(1);
  });

  it('refuses data that is cut short or is not protobuf', () => {
    expect(() => decodeMessage(Uint8Array.from([0x0a, 0x05, 0x41]), 'test.Doc', d)).toThrow(ProtobufError);
    expect(() => decodeMessage(Uint8Array.from([0x00]), 'test.Doc', d)).toThrow('Field number 0');
    expect(() => decodeMessage(new TextEncoder().encode('TEMPLATE = app'), 'test.Doc', d)).toThrow(
      ProtobufError,
    );
    expect(() => decodeMessage(new Uint8Array(), 'test.Missing', d)).toThrow('No definition');
  });
});
