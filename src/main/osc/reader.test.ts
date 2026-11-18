import { describe, expect, it } from 'vitest';
import { OSC_LIMITS, readOsc } from './reader';

const string = (s: string) => {
  const bytes = Buffer.from(s + '\0', 'ascii');
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
};
const int = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const tag = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
};
const message = (tags = '', ...args: Buffer[]) =>
  Buffer.concat([string('/drashti/next'), string(',' + tags), ...args]);
const bundle = (time: bigint, ...items: Buffer[]) =>
  Buffer.concat([string('#bundle'), tag(time), ...items.flatMap((m) => [int(m.length), m])]);
const argument = (type: string, value: unknown) => ({ type, value });

describe('OSC 1.0 reader', () => {
  it('reads the specification wire example, including signed big-endian integers and float32', () => {
    const wire = Buffer.from(
      '2f666f6f000000002c69697366660000000003e8ffffffff68656c6c6f0000003f9e04193ff3b646',
      'hex',
    );
    expect(readOsc(wire)).toEqual([{
      address: '/foo', timetag: 1n,
      arguments: [argument('i', 1000), argument('i', -1), argument('s', 'hello'),
        argument('f', expect.closeTo(1.2345, 5)), argument('f', expect.closeTo(1.904, 5))],
    }]);
  });

  it('reads a no-argument message and all four required types, with a padded binary blob', () => {
    expect(readOsc(message())).toEqual([{ address: '/drashti/next', arguments: [], timetag: 1n }]);
    const float = Buffer.from('c0200000', 'hex');
    expect(readOsc(message('ifsb', int(-42), float, string('Placeholder'), int(3), Buffer.from([0, 255, 1, 0]))))
      .toEqual([{ address: '/drashti/next', timetag: 1n, arguments: [
        argument('i', -42), argument('f', -2.5), argument('s', 'Placeholder'), argument('b', Buffer.from([0, 255, 1])),
      ] }]);
    expect(readOsc(message('b', int(0)))?.[0]?.arguments).toEqual([argument('b', Buffer.alloc(0))]);
  });

  it('reads every optional type and nested arrays without losing its tag', () => {
    const double = Buffer.alloc(8); double.writeDoubleBE(-123.25);
    const signed = Buffer.alloc(8); signed.writeBigInt64BE(-9223372036854775808n);
    const packet = message('htdScrmTFNI[i[s]]', signed, tag(0x1234567890abcdefn), double,
      string('symbol'), int(65), Buffer.from('ff007fff', 'hex'), Buffer.from('01903c64', 'hex'),
      int(7), string('nested'));
    expect(readOsc(packet)?.[0]?.arguments).toEqual([
      argument('h', -9223372036854775808n), argument('t', 0x1234567890abcdefn), argument('d', -123.25),
      argument('S', 'symbol'), argument('c', 'A'), argument('r', 0xff007fff),
      argument('m', Buffer.from('01903c64', 'hex')), argument('T', true), argument('F', false),
      argument('N', null), argument('I', Infinity),
      argument('[', [argument('i', 7), argument('[', [argument('s', 'nested')])]),
    ]);
  });

  it('reads empty and nested bundles in wire order and retains exact time tags', () => {
    expect(readOsc(bundle(1n))).toEqual([]);
    const parsed = readOsc(bundle(10n, message('i', int(1)), bundle(11n, message('i', int(2))), message('i', int(3))));
    expect(parsed?.map((m) => [m.timetag, m.arguments[0]?.value])).toEqual([[10n, 1], [11n, 2], [10n, 3]]);
    expect(readOsc(bundle(1n, bundle(1n, message())))?.[0]?.timetag).toBe(1n);
    expect(readOsc(bundle(10n, bundle(9n, message())))).toBeNull();
  });

  it('rejects a malformed tail as a whole, with no partially read messages', () => {
    expect(readOsc(bundle(1n, message(), message('x')))).toBeNull();
  });

  it.each([
    Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(4), string('not/an/address'),
    string('/missing-tags'), message('x'), message('i'), message('f'), message('d'), message('h'), message('t'),
    message('b', int(-1)), message('b', int(100)), message('s', Buffer.from('61000100', 'hex')),
    message('s', Buffer.from('ff000000', 'hex')), message('c', int(128)),
    message('f', Buffer.from('7f800000', 'hex')), message('f', Buffer.from('7fc00000', 'hex')),
    message('d', Buffer.from('7ff0000000000000', 'hex')), message('['), message(']'), message('[i', int(1)),
    Buffer.concat([message(), int(0)]), bundle(1n, Buffer.alloc(0)),
    Buffer.concat([string('#bundle'), tag(1n), int(-4)]),
    Buffer.concat([string('#bundle'), tag(1n), int(16), message()]),
    Buffer.concat([string('#bundle'), tag(1n), int(3), Buffer.alloc(4)]),
  ])('drops malformed data without throwing (%#)', (packet) => {
    expect(() => readOsc(packet)).not.toThrow();
    expect(readOsc(packet)).toBeNull();
  });

  it('checks packet, bundle depth, message count and argument budgets', () => {
    expect(readOsc(Buffer.alloc(OSC_LIMITS.bytes + 4))).toBeNull();
    let nested = message();
    for (let n = 0; n <= OSC_LIMITS.depth; n++) nested = bundle(1n, nested);
    expect(readOsc(nested)).toBeNull();
    expect(readOsc(bundle(1n, ...Array.from({ length: OSC_LIMITS.messages + 1 }, () => message())))).toBeNull();
    expect(readOsc(message('T'.repeat(OSC_LIMITS.arguments + 1)))).toBeNull();
    expect(readOsc(bundle(1n, ...Array.from({ length: 5 }, () => message('T'.repeat(64)))))).toBeNull();
    expect(readOsc(message('['.repeat(10) + ']'.repeat(10)))).toBeNull();
  });

  it('never throws for any truncated prefix, padding corruption, or deterministic random bytes', () => {
    const good = bundle(1n, message('isb', int(-3), string('Placeholder'), int(3), Buffer.from([1, 2, 3, 0])));
    for (let n = 0; n < good.length; n++) expect(() => readOsc(good.subarray(0, n))).not.toThrow();
    let seed = 12345;
    for (let n = 0; n < 500; n++) {
      const bytes = Buffer.alloc(n % 257);
      for (let i = 0; i < bytes.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[i] = seed & 255; }
      expect(() => readOsc(bytes)).not.toThrow();
    }
  });
});
