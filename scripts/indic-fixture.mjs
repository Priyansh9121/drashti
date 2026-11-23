// Neutral test graph, generated here, never downloaded weights. Minimal ONNX protobuf encoder: only varint and
// length-delimited fields are needed. The output deliberately repeats a token across a blank to test CTC collapse.
const varint = (value) => {
  const bytes = [];
  do {
    const b = value % 128;
    value = Math.floor(value / 128);
    bytes.push(b | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
};
const integer = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const message = (field, value) => {
  const data = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);
};
const fields = (...values) => Buffer.concat(values);
const shape = (dims) =>
  fields(...dims.map((d) => message(1, typeof d === 'number' ? integer(1, d) : message(2, d))));
const info = (name, type, dims) =>
  fields(message(1, name), message(2, message(1, fields(integer(1, type), message(2, shape(dims))))));

export function makeIndicFixture({ trailingSeparator = false } = {}) {
  const sequence = [0, 0, 256, 0, 1, 256, ...(trailingSeparator ? [2, 256] : [])];
  const logits = Buffer.alloc(sequence.length * 257 * 4);
  for (let t = 0; t < sequence.length; t += 1)
    for (let k = 0; k < 257; k += 1) logits.writeFloatLE(k === sequence[t] ? 0 : -20, (t * 257 + k) * 4);
  const tensor = fields(
    integer(1, 1),
    integer(1, sequence.length),
    integer(1, 257),
    integer(2, 1),
    message(8, 'logprobs_lang'),
    message(9, logits),
  );
  const graph = fields(
    message(2, 'neutral-ctc-fixture'),
    message(5, tensor),
    message(11, info('audio_signal', 1, [1, 80, 'T'])),
    message(11, info('length', 7, [1])),
    message(12, info('logprobs_lang', 1, [1, sequence.length, 257])),
  );
  return {
    model: fields(
      integer(1, 8),
      message(2, 'Drashti-generated-test'),
      message(7, graph),
      message(8, integer(2, 17)),
    ),
    tokens:
      ['▁shape', '▁box', '▁', ...Array.from({ length: 253 }, (_, i) => `unused${i}`), '<blank>'].join('\n') +
      '\n',
    // Zero mel bank yields finite constant log-energy; this fixture tests protocol and decoder, not acoustic quality.
    frontend: Buffer.alloc(80 * 257 * 4),
  };
}
