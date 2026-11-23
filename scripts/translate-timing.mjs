// The translation engine's speed without a model pack (alpha.23, a22-intel; a22-review-mt A2): drashti-translate,
// started as Drashti starts it, translating one placeholder sentence with GENERATED models only. Made for the one
// hand-started job on GitHub's Intel Mac runner (performance.yml, input translate_intel), and runs on any Mac:
//   node scripts/translate-timing.mjs make <folder> [--size tiny|full]     write a generated model
//   node scripts/translate-timing.mjs proof <helper> --work <folder>        the whole proof, its verdict, exit 1 if red
// The models are generated weights of IndicTrans2's int8 CTranslate2 layout (a WORD SentencePiece model for the
// sentence's own pieces): "tiny" (a few KB, committed in tests/fixtures/translation/timing-model/) and "full"
// (IndicTrans2-dist's shape: 18 + 18 layers, width 512, its two vocabularies' sizes; about 215 MB, made where it
// runs). They translate nothing meaningful: only their speed and the code paths taken count. The timing refuses any
// folder that is not byte for byte what this script generates, so a real model is never timed or read here.
// The proof reads which instruction set CTranslate2 dispatches to (CT2_VERBOSE=1), which of ruy's kernels the
// program holds (nm) and runs (a sample of the helper while it translates), and times the careful search (beam 5)
// against the app's 30 s limit for one sentence. Nothing is downloaded.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { constants, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed tiny model, relative to the repository. */
export const FIXTURE_DIR = 'tests/fixtures/translation/timing-model';
export const FIXTURE_FILES = [
  'config.json',
  'model.bin',
  'source.spm',
  'source_vocabulary.json',
  'target_vocabulary.json',
];
/** Each generated file's SHA-256: the timing takes no other folder. */
export const FIXTURE_SHA256 = {
  tiny: {
    'config.json': '8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af',
    'model.bin': 'b2ee5fd2966fc599fa234ec0cb42d0e371c8d90bab8ea840bf7a4d5413b20fd8',
    'source.spm': '6e9c06d3ff1993fdc16f7d35ac0484d6ecb1f6c8b0f05b07add9894d7b12cf63',
    'source_vocabulary.json': '9aadd8a7365854933ee8aa5eddd80260c7c4a28b28a4c5cf8f2f0cc32e2dfafb',
    'target_vocabulary.json': 'e697add41c7c397487ffa614db3af5628ed0573c1ac67218698c0539fbb9b589',
  },
  full: {
    'config.json': '8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af',
    'model.bin': '993758ceda145bda8a75cb8f50b9cc52bd1b89cbd0c10829318b22ed7ad7713e',
    'source.spm': '6e9c06d3ff1993fdc16f7d35ac0484d6ecb1f6c8b0f05b07add9894d7b12cf63',
    'source_vocabulary.json': '9338db016ca9efda94f1c3a4a766d5e1aaf782e36e581a5ada72091d02794083',
    'target_vocabulary.json': 'd42dfd0fcb5d0d518962b895dd7db280295c1729b5adf7cd5bfd8dada100d733',
  },
};

/** The app's limits (TranslationHelper): one sentence (translateMs), loading a model (loadMs). */
export const LIMIT_MS = 30_000;
export const LOAD_LIMIT_MS = 60_000;
/** Placeholder words, nothing real. */
export const SENTENCE = 'The engine reads this short sentence and writes another one in its place.';
/** The pieces SentencePiece's WORD model makes of it (a dummy prefix, spaces as U+2581). */
export const SENTENCE_PIECES = SENTENCE.split(' ').map((w) => `▁${w}`);

const SPECIALS = ['<s>', '<pad>', '</s>', '<unk>'];
const TAGS = ['eng_Latn', 'guj_Gujr', 'hin_Deva'];

/** The two generated shapes. "full" is IndicTrans2-dist's en-indic model's (x74's int8 conversion). */
export const SIZES = {
  tiny: {
    width: 16,
    heads: 2,
    ffn: 32,
    encoderLayers: 1,
    decoderLayers: 1,
    sourceVocab: 20,
    targetVocab: 24,
    positions: 0,
  },
  full: {
    width: 512,
    heads: 8,
    ffn: 2048,
    encoderLayers: 18,
    decoderLayers: 18,
    sourceVocab: 32_322,
    targetVocab: 122_672,
    positions: 256,
  },
};

// ------------------------------------------------------------------------------------------- generated weights

const TYPE_ID = { float32: 0, int8: 1, int16: 2 };

/** FNV-1a of a variable's name: each variable's numbers depend on its name only. */
function seedOf(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h || 1;
}

/** xorshift32 into `words`, from `state`; returns the next state. The same numbers on every computer. */
function xorshift(words, state) {
  let x = state;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    words[i] = x;
  }
  return x;
}

// A random byte as an int8 weight in [-127, 127], as CTranslate2's int8 weights are (0 taken as 1, then the sign
// bit flipped: 1..255 become -127..127).
const INT8 = Uint8Array.from({ length: 256 }, (_, b) => (b === 0 ? 1 : b) ^ 0x80);
const CHUNK = 1 << 20;

/** A variable's bytes, in chunks of at most 1 MiB (little-endian, as every computer Drashti runs on). */
function* variableBytes(v) {
  const count = v.dims.reduce((a, b) => a * b, 1);
  if (v.fill === 'scalar') {
    const b = Buffer.alloc(v.type === 'float32' ? 4 : v.type === 'int16' ? 2 : 1);
    if (v.type === 'float32') b.writeFloatLE(v.value, 0);
    else if (v.type === 'int16') b.writeInt16LE(v.value, 0);
    else b.writeInt8(v.value, 0);
    yield b;
    return;
  }
  let state = seedOf(v.name);
  if (v.type === 'int8') {
    for (let done = 0; done < count; done += CHUNK) {
      const n = Math.min(CHUNK, count - done);
      const bytes = new Uint8Array(Math.ceil(n / 4) * 4);
      state = xorshift(new Uint32Array(bytes.buffer), state);
      for (let i = 0; i < n; i++) bytes[i] = INT8[bytes[i] ?? 0] ?? 1;
      yield Buffer.from(bytes.buffer, 0, n);
    }
    return;
  }
  // float32: ones (layer norm scales), zeros (biases, shifts), a weight scale, or small numbers (positions).
  for (let done = 0; done < count; done += CHUNK / 4) {
    const n = Math.min(CHUNK / 4, count - done);
    const f = new Float32Array(n);
    if (v.fill === 'ones') f.fill(1);
    else if (v.fill === 'scale') f.fill(1270);
    else if (v.fill === 'random') {
      const words = new Uint32Array(n);
      state = xorshift(words, state);
      for (let i = 0; i < n; i++) f[i] = ((words[i] ?? 0) / 4294967296 - 0.5) * 0.2;
    }
    yield Buffer.from(f.buffer);
  }
}

/** IndicTrans2's int8 CTranslate2 layout (TransformerSpec revision 7), at one size. */
export function modelLayout(size) {
  const s = SIZES[size];
  if (!s) throw new Error(`No generated model of size ${String(size)}`);
  const variables = [];
  const add = (name, dims, type, fill, value) => variables.push({ name, dims, type, fill, value });
  const scalar = (name, type, value) => add(name, [], type, 'scalar', value);
  const norm = (scope) => {
    add(`${scope}/beta`, [s.width], 'float32', 'zeros');
    add(`${scope}/gamma`, [s.width], 'float32', 'ones');
  };
  const linear = (scope, out, inp) => {
    add(`${scope}/bias`, [out], 'float32', 'zeros');
    add(`${scope}/weight`, [out, inp], 'int8', 'random');
    add(`${scope}/weight_scale`, [out], 'float32', 'scale');
  };
  const ffn = (scope) => {
    norm(`${scope}/ffn/layer_norm`);
    linear(`${scope}/ffn/linear_0`, s.ffn, s.width);
    linear(`${scope}/ffn/linear_1`, s.width, s.ffn);
  };
  const selfAttention = (scope) => {
    norm(`${scope}/self_attention/layer_norm`);
    linear(`${scope}/self_attention/linear_0`, 3 * s.width, s.width);
    linear(`${scope}/self_attention/linear_1`, s.width, s.width);
  };
  for (const side of ['encoder', 'decoder']) {
    scalar(`${side}/activation`, 'int8', 3); // GELU
    norm(`${side}/layer_norm`);
    norm(`${side}/layernorm_embedding`);
    scalar(`${side}/num_heads`, 'int16', s.heads);
    scalar(`${side}/pre_norm`, 'int8', 1);
    scalar(`${side}/scale_embeddings`, 'float32', Math.sqrt(s.width));
  }
  add('encoder/embeddings_0/weight', [s.sourceVocab, s.width], 'int8', 'random');
  add('encoder/embeddings_0/weight_scale', [s.sourceVocab], 'float32', 'scale');
  scalar('encoder/embeddings_merge', 'int8', 0);
  scalar('encoder/multi_query_attention', 'int8', 0);
  for (let i = 0; i < s.encoderLayers; i++) {
    ffn(`encoder/layer_${String(i)}`);
    selfAttention(`encoder/layer_${String(i)}`);
  }
  scalar('decoder/alibi', 'int8', 0);
  scalar('decoder/alibi_use_positive_positions', 'int8', 0);
  scalar('decoder/alignment_heads', 'int16', 1);
  scalar('decoder/alignment_layer', 'int16', -1);
  scalar('decoder/scale_alibi', 'int8', 0);
  scalar('decoder/start_from_zero_embedding', 'int8', 0);
  add('decoder/embeddings/weight', [s.targetVocab, s.width], 'int8', 'random');
  add('decoder/embeddings/weight_scale', [s.targetVocab], 'float32', 'scale');
  for (let i = 0; i < s.decoderLayers; i++) {
    const scope = `decoder/layer_${String(i)}`;
    norm(`${scope}/attention/layer_norm`);
    linear(`${scope}/attention/linear_0`, s.width, s.width);
    linear(`${scope}/attention/linear_1`, 2 * s.width, s.width);
    linear(`${scope}/attention/linear_2`, s.width, s.width);
    ffn(scope);
    selfAttention(scope);
  }
  // Without a table CTranslate2 makes the sinusoidal positions itself (the tiny model); the real one keeps 256.
  const aliases = [['decoder/projection/weight', 'decoder/embeddings/weight']];
  if (s.positions > 0) {
    add('decoder/position_encodings/encodings', [s.positions, s.width], 'float32', 'random');
    aliases.push(['encoder/position_encodings/encodings', 'decoder/position_encodings/encodings']);
  }
  variables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { variables, aliases };
}

const u8 = (n) => Buffer.from([n]);
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
// CTranslate2's strings: their length with the closing NUL, the bytes, the NUL.
const cstring = (s) => Buffer.concat([u16(Buffer.byteLength(s) + 1), Buffer.from(s, 'utf8'), u8(0)]);

/** model.bin in CTranslate2's format (binary version 6), in chunks. */
function* modelBin(size) {
  const { variables, aliases } = modelLayout(size);
  yield Buffer.concat([u32(6), cstring('TransformerSpec'), u32(7), u32(variables.length)]);
  for (const v of variables) {
    const count = v.dims.reduce((a, b) => a * b, 1);
    const item = v.type === 'float32' ? 4 : v.type === 'int16' ? 2 : 1;
    yield Buffer.concat([
      cstring(v.name),
      u8(v.dims.length),
      ...v.dims.map(u32),
      u8(TYPE_ID[v.type]),
      u32(count * item),
    ]);
    yield* variableBytes(v);
  }
  yield u32(aliases.length);
  for (const [alias, name] of aliases) yield Buffer.concat([cstring(alias), cstring(name)]);
}

// Protocol buffers, by hand (SentencePiece's ModelProto), for one small message.
const varint = (n) => {
  const out = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
};
const field = (number, bytes) => Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
const flag = (number, value) => Buffer.concat([varint(number << 3), varint(value)]);

/** source.spm: a WORD model holding the sentence's pieces (the unknown, the two control tokens, then the words). */
function sentencePieceModel() {
  const piece = (text, type) =>
    field(1, Buffer.concat([field(1, Buffer.from(text, 'utf8')), ...(type ? [flag(3, type)] : [])]));
  const pieces = [
    piece('<unk>', 2),
    piece('<s>', 3),
    piece('</s>', 3),
    ...SENTENCE_PIECES.map((p) => piece(p)),
  ];
  const trainer = field(2, Buffer.concat([flag(3, 3), flag(4, pieces.length)])); // WORD, its vocabulary size
  const normalizer = field(
    3,
    Buffer.concat([field(1, Buffer.from('identity')), flag(3, 1), flag(4, 1), flag(5, 1)]),
  );
  return Buffer.concat([...pieces, trainer, normalizer]);
}

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/** Every file of the generated model, each as chunks. */
function* modelFiles(size) {
  const s = SIZES[size];
  if (!s) throw new Error(`No generated model of size ${String(size)}`);
  const source = [...SPECIALS, ...TAGS, ...SENTENCE_PIECES];
  for (let i = source.length; i < s.sourceVocab; i++) source.push(`s${String(i)}`);
  const target = [...SPECIALS];
  for (let i = target.length; i < s.targetVocab; i++) target.push(`t${String(i)}`);
  if (source.length !== s.sourceVocab) throw new Error('The source vocabulary does not fit its size');
  // As x74's IndicTrans2 conversions say.
  yield [
    'config.json',
    [
      json({
        add_source_bos: false,
        add_source_eos: false,
        bos_token: '<s>',
        decoder_start_token: '</s>',
        eos_token: '</s>',
        layer_norm_epsilon: null,
        multi_query_attention: false,
        unk_token: '<unk>',
      }),
    ],
  ];
  yield ['model.bin', modelBin(size)];
  yield ['source.spm', [sentencePieceModel()]];
  yield ['source_vocabulary.json', [json(source)]];
  yield ['target_vocabulary.json', [json(target)]];
}

/** Write the generated model into a new folder. */
export function makeModel(dir, size) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, chunks] of modelFiles(size)) {
    const fd = openSync(join(dir, name), 'w');
    try {
      for (const chunk of chunks) writeSync(fd, chunk);
    } finally {
      closeSync(fd);
    }
  }
}

/** Each generated file's SHA-256, without writing anything. */
export function hashModel(size) {
  const out = {};
  for (const [name, chunks] of modelFiles(size)) {
    const h = createHash('sha256');
    for (const chunk of chunks) h.update(chunk);
    out[name] = h.digest('hex');
  }
  return out;
}

/** What makes a folder other than the generated model (empty when it is that model, byte for byte). */
export function checkModel(dir, size) {
  const want = FIXTURE_SHA256[size];
  if (!want) return [`no generated model of size ${String(size)}`];
  const problems = [];
  const present = existsSync(dir) ? readdirSync(dir) : [];
  for (const f of present.filter((f) => !FIXTURE_FILES.includes(f)).sort())
    problems.push(`${f} is not part of the generated model`);
  for (const f of FIXTURE_FILES) {
    if (!present.includes(f)) problems.push(`${f} is missing`);
    else if (
      createHash('sha256')
        .update(readFileSync(join(dir, f)))
        .digest('hex') !== want[f]
    )
      problems.push(`${f} is not the generated ${size} model’s`);
  }
  return problems;
}

// ------------------------------------------------------------------------------------------- what is read

/** CTranslate2's own words at its first model (CT2_VERBOSE=1, src/utils.cc log_system_config). */
export function readCt2Log(text) {
  const at = (re) => re.exec(text)?.[1]?.trim() ?? null;
  return {
    cpu: at(/\bCPU: ([^\n]+)/u),
    isa: at(/Selected ISA: (\S+)/u),
    gemm8: at(/GEMM_S8 backend: (\S+)/u),
  };
}

/** The processor, from sysctl's values (machdep.cpu.* on Intel, hw.optional.arm.* on Apple silicon). */
export function readSystem(arch, values) {
  const words = `${values['machdep.cpu.features'] ?? ''} ${values['machdep.cpu.leaf7_features'] ?? ''}`
    .toUpperCase()
    .split(/\s+/u);
  return {
    arch,
    brand: values['machdep.cpu.brand_string'] ?? '',
    avx: words.includes('AVX1.0'),
    avx2: words.includes('AVX2'),
    fma: words.includes('FMA'),
    avx512f: words.includes('AVX512F'),
    dotprod: values['hw.optional.arm.FEAT_DotProd'] === '1',
  };
}

function sysctlValues() {
  const names = [
    'machdep.cpu.brand_string',
    'machdep.cpu.features',
    'machdep.cpu.leaf7_features',
    'hw.optional.arm.FEAT_DotProd',
  ];
  const values = {};
  for (const n of names) {
    const r = spawnSync('/usr/sbin/sysctl', ['-n', n], { encoding: 'utf8' });
    if (r.status === 0) values[n] = r.stdout.trim();
  }
  return values;
}

/** Which of ruy's int8 kernels the program holds (its symbol table). */
export function readSymbols(program) {
  const r = spawnSync('nm', ['-U', program], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = r.status === 0 ? r.stdout : '';
  return {
    avx2: /Kernel8bitAvx2/u.test(text),
    avx512: /Kernel8bitAvx512/u.test(text),
    neon: /Kernel8bitNeon/u.test(text),
  };
}

/** Samples at the top of the stack in ruy's kernels, by kind (macOS's sample, its "Sort by top of stack"). */
export function readSample(text) {
  const counts = { avx512: 0, avx2: 0, avx: 0, neon: 0, standard: 0 };
  const section = text.split(/^Sort by top of stack[^\n]*\n/mu)[1]?.split(/\n\s*\n/u)[0] ?? '';
  for (const line of section.split('\n')) {
    const m = /^\s+(.+?)\s+\(in [^)]+\)\s+(\d+)\s*$/u.exec(line);
    if (!m) continue;
    const symbol = m[1] ?? '';
    const n = Number(m[2]);
    if (!symbol.includes('ruy::')) continue;
    if (/Avx512/u.test(symbol)) counts.avx512 += n;
    else if (/Avx2/u.test(symbol)) counts.avx2 += n;
    else if (/Avx/u.test(symbol)) counts.avx += n;
    else if (/Neon/u.test(symbol)) counts.neon += n;
    else if (/\(ruy::Path\)1[,>]/u.test(symbol)) counts.standard += n;
  }
  return counts;
}

// ------------------------------------------------------------------------------------------- the timing

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : 0;
};
const max = (xs) => xs.reduce((a, b) => Math.max(a, b), 0);

/** Start the helper as Drashti does: a Mac's background QoS (taskpolicy -b) and below-normal priority. */
function startHelper(program) {
  const env = { ...process.env, CT2_VERBOSE: '1' };
  const child =
    process.platform === 'darwin'
      ? spawn('/usr/sbin/taskpolicy', ['-b', program], { stdio: 'pipe', env })
      : spawn(program, [], { stdio: 'pipe', env, windowsHide: true });
  return child;
}

/** One helper's session: replies by id, stderr kept (CTranslate2's log), each wait bounded. */
function session(child) {
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const waiting = new Map();
  let hello = null;
  let helloWait = null;
  child.stdout.on('data', (d) => {
    buffer += d.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r && r.hello) {
        hello = r;
        helloWait?.(r);
      } else if (r && waiting.has(r.id)) {
        waiting.get(r.id)(r);
        waiting.delete(r.id);
      }
    }
  });
  child.stderr.on('data', (d) => {
    if (stderr.length < 1_000_000) stderr += d.toString();
  });
  child.stdin.on('error', () => undefined);
  let finish = null;
  const ended = new Promise((resolve) => (finish = resolve));
  child.on('close', (code) => finish(`exit ${String(code)}`));
  child.on('error', (error) => finish(error.message));
  // Each wait bounded: a stuck helper ends the timing, never hangs the job. Settling twice is a no-op.
  const within = (promise, ms, what) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what}: no answer in ${String(ms)} ms`)), ms);
      void ended.then((why) => {
        clearTimeout(timer);
        reject(new Error(`${what}: the helper ended (${why})`));
      });
      void promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  return {
    hello: () =>
      hello ? Promise.resolve(hello) : within(new Promise((r) => (helloWait = r)), 60_000, 'hello'),
    ask: (request, ms) => {
      const id = nextId++;
      const reply = new Promise((resolve) => waiting.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
      return within(reply, ms, request.op);
    },
    stderr: () => stderr,
    ended,
  };
}

/** A sample of the helper for a few seconds (macOS only; through sudo on a CI runner if it must). */
function sampleOf(pid, seconds, file) {
  return new Promise((resolve) => {
    const tryIt = (command, args, next) => {
      const p = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      let done = false;
      const end = (failure) => {
        if (done) return;
        done = true;
        if (!failure && existsSync(file)) resolve({ text: readFileSync(file, 'utf8'), error: null });
        else if (next) next();
        else resolve({ text: null, error: failure || 'sample wrote nothing' });
      };
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => end(e.message));
      p.on('close', (code) =>
        end(code === 0 ? null : err.trim().split('\n')[0] || `sample exit ${String(code)}`),
      );
    };
    const args = [String(pid), String(seconds), '-file', file];
    tryIt(
      '/usr/bin/sample',
      args,
      process.env.GITHUB_ACTIONS === 'true'
        ? () => tryIt('sudo', ['-n', '/usr/bin/sample', ...args], null)
        : null,
    );
  });
}

/**
 * Time one generated model: load it (2 threads, as the app), check its pieces, then each run of the plan
 * ({ beam, count, warm, sample }) translates the sentence `count` times after `warm` unmeasured ones. Refuses,
 * before starting anything, a folder that is not the generated model of that size.
 */
export async function timeModel(program, dir, size, plan, { sampleFile = null } = {}) {
  const refused = checkModel(dir, size);
  if (refused.length) throw new Error(`${dir} is not the generated ${size} model: ${refused.join('; ')}`);
  const child = startHelper(program);
  try {
    setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // It may have ended already; the session says so.
  }
  const s = session(child);
  const problems = [];
  const runs = [];
  let sample = null;
  let sampleError = null;
  let loadMs = null;
  try {
    await s.hello();
    const load = await s.ask(
      { op: 'load', route: 'en-indic', model: dir, spm: join(dir, 'source.spm'), threads: 2 },
      180_000,
    );
    if (!load.ok) throw new Error(`load: ${String(load.error)}`);
    loadMs = load.loadMs;
    const pieces = await s.ask({ op: 'pieces', route: 'en-indic', text: SENTENCE }, 30_000);
    if (!pieces.ok || JSON.stringify(pieces.tokens) !== JSON.stringify(SENTENCE_PIECES))
      problems.push(`pieces: ${JSON.stringify(pieces.tokens ?? pieces.error)}`);
    const sentence = (beam) =>
      s.ask(
        { op: 'translate', route: 'en-indic', src: 'eng_Latn', tgt: 'guj_Gujr', text: SENTENCE, beam },
        180_000,
      );
    for (const step of plan) {
      for (let i = 0; i < (step.warm ?? 0); i++) await sentence(step.beam);
      const run = { beam: step.beam, ms: [], helperMs: [], tokens: [] };
      for (let i = 0; i < step.count; i++) {
        const sampling = step.sample && i === 0 && sampleFile && process.platform === 'darwin';
        const sampled = sampling ? sampleOf(child.pid, 2, sampleFile) : null;
        const started = performance.now();
        const r = await sentence(step.beam);
        const ms = Math.round(performance.now() - started);
        if (sampled) {
          const got = await sampled;
          if (got.text) sample = readSample(got.text);
          else sampleError = got.error;
        }
        if (!r.ok) {
          problems.push(`beam ${String(step.beam)} sentence ${String(i + 1)}: ${String(r.error)}`);
          continue;
        }
        run.ms.push(ms);
        run.helperMs.push(r.ms);
        run.tokens.push(r.tokens.length);
      }
      runs.push(run);
    }
    await s.ask({ op: 'quit' }, 30_000);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await s.ended;
    clearTimeout(timer);
  }
  return {
    ok: problems.length === 0,
    problems,
    loadMs,
    runs,
    ct2: readCt2Log(s.stderr()),
    sample,
    sampleError,
  };
}

// ------------------------------------------------------------------------------------------- the verdict

const stat = (run) =>
  run && run.ms.length
    ? `median ${String(Math.round(median(run.ms)))} ms, max ${String(max(run.ms))} ms per sentence (${String(median(run.tokens))} tokens out, ${(median(run.ms) / Math.max(1, median(run.tokens))).toFixed(1)} ms a token; ${String(run.ms.length)} sentences)`
    : 'no timing';

/** Green or red, with its reasons and the lines for the job's summary. */
export function judge({ system, symbols, ct2, sample, sampleError, tiny, full }) {
  const intel = system.arch === 'x64';
  const problems = [];
  if (intel && !(system.avx2 && system.fma)) problems.push('the processor has no AVX2 and FMA');
  const fastIsa = intel ? ['AVX2', 'AVX512'] : ['NEON'];
  if (!fastIsa.includes(ct2.isa ?? ''))
    problems.push(`CTranslate2 dispatches to ${String(ct2.isa)}, not ${intel ? 'AVX2 or better' : 'NEON'}`);
  if (ct2.gemm8 !== 'Ruy') problems.push(`the int8 products run on ${String(ct2.gemm8)}, not ruy`);
  if (intel && !symbols.avx2)
    problems.push('ruy’s AVX2 kernel is not in the program (its x86 fast paths are compiled out)');
  if (!intel && !symbols.neon) problems.push('ruy’s NEON kernel is not in the program');
  if (sample) {
    const fast = intel ? sample.avx512 + sample.avx2 : sample.neon;
    if (fast === 0)
      problems.push(
        sample.standard > 0
          ? `ruy ran its reference C++ kernel while translating (${String(sample.standard)} samples), never an ${intel ? 'AVX' : 'NEON'} one`
          : sample.avx > 0
            ? 'ruy ran only its AVX kernel while translating, not AVX2 or better'
            : 'no ruy kernel was seen while translating',
      );
  }
  if (!tiny.ok) problems.push(`tiny model: ${tiny.problems.join('; ')}`);
  if (!full.ok) problems.push(`full-size model: ${full.problems.join('; ')}`);
  if (typeof full.loadMs === 'number' && full.loadMs >= LOAD_LIMIT_MS)
    problems.push(
      `the full-size model took ${String(full.loadMs)} ms to load: over the app’s ${String(LOAD_LIMIT_MS)} ms`,
    );
  const careful = full.runs.find((r) => r.beam === 5);
  if (!careful || careful.ms.length === 0) {
    if (full.ok) problems.push('full-size model: no careful-search (beam 5) timing');
  } else if (max(careful.ms) >= LIMIT_MS)
    problems.push(
      `a full-size sentence took ${String(max(careful.ms))} ms with the careful search (beam 5): over the app’s ${String(LIMIT_MS)} ms`,
    );
  const green = problems.length === 0;
  const yes = (b) => (b ? 'yes' : 'no');
  const sampled = sample
    ? `AVX-512 ${String(sample.avx512)}, AVX2 ${String(sample.avx2)}, AVX ${String(sample.avx)}, NEON ${String(sample.neon)}, reference C++ ${String(sample.standard)} samples`
    : `not sampled (${String(sampleError)})`;
  const lines = [
    `## Translation engine on ${intel ? 'an Intel' : 'an Apple silicon'} Mac (generated models only, no model pack)`,
    '',
    green
      ? `**GREEN**: CTranslate2 dispatches to ${String(ct2.isa)}, ruy runs its ${intel ? 'AVX2-or-better' : 'NEON'} kernel, and the careful search (beam 5) on a full-size model takes ${careful ? String(max(careful.ms)) : '?'} ms at most per sentence (the app stops one at ${String(LIMIT_MS)} ms).`
      : `**RED**: ${problems.join('; ')}.`,
    '',
    `- Processor: ${system.brand || system.arch}; ${intel ? `AVX2 ${yes(system.avx2)}, FMA ${yes(system.fma)}, AVX-512F ${yes(system.avx512f)}` : `dot product ${yes(system.dotprod)}`}`,
    `- CTranslate2 (CT2_VERBOSE=1): CPU ${String(ct2.cpu)}; Selected ISA: ${String(ct2.isa)}; GEMM_S8 backend: ${String(ct2.gemm8)}`,
    `- ruy's int8 kernels in the program: AVX2 ${yes(symbols.avx2)}, AVX-512 ${yes(symbols.avx512)}, NEON ${yes(symbols.neon)}`,
    `- ruy's kernel while translating (a 2 s sample of the first careful-search sentence): ${sampled}`,
    `- Tiny generated model (the committed fixture), greedy: ${stat(tiny.runs.find((r) => r.beam === 1))}`,
    `- Full-size generated model (IndicTrans2-dist's shape), as the app runs it (background QoS, below-normal priority, 2 threads), loaded in ${String(full.loadMs ?? '?')} ms:`,
    `  - greedy: ${stat(full.runs.find((r) => r.beam === 1))}`,
    `  - careful search (beam 5, the app's drafts): ${stat(careful)}`,
    `- Random weights rarely end a sentence, so most run to the helper's 256-token cap: real sentences are far shorter.`,
    `- For comparison: the same command on an Apple silicon Mac (\`node scripts/translate-timing.mjs proof <its helper> --work <folder>\`); no Apple silicon job runs here.`,
  ];
  return { green, problems, lines };
}

/** The whole proof: the processor, the program's kernels, the tiny fixture, the full-size model; the verdict. */
export async function proof(program, work, { runsTiny = 20, runsFull = 5 } = {}) {
  mkdirSync(work, { recursive: true });
  const system = readSystem(process.arch, sysctlValues());
  const symbols = readSymbols(program);
  const tiny = await timeModel(program, join(root, FIXTURE_DIR), 'tiny', [
    { beam: 1, count: runsTiny, warm: 1 },
  ]);
  const fullDir = join(work, 'full-model');
  if (checkModel(fullDir, 'full').length) makeModel(fullDir, 'full');
  const full = await timeModel(
    program,
    fullDir,
    'full',
    [
      { beam: 1, count: runsFull, warm: 1 },
      { beam: 5, count: runsFull, warm: 1, sample: true },
    ],
    { sampleFile: join(work, 'sample-beam5.txt') },
  );
  const verdict = judge({
    system,
    symbols,
    ct2: tiny.ct2.isa ? tiny.ct2 : full.ct2,
    sample: full.sample,
    sampleError: full.sampleError,
    tiny,
    full,
  });
  writeFileSync(
    join(work, 'translate-timing.json'),
    `${JSON.stringify({ system, symbols, tiny, full, verdict }, null, 2)}\n`,
  );
  return verdict;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  if (command === 'make' && args[0]) {
    makeModel(args[0], option('--size', 'tiny'));
    return;
  }
  if (command === 'proof' && args[0] && option('--work')) {
    const verdict = await proof(args[0], option('--work'), {
      runsTiny: Number(option('--runs-tiny', '20')),
      runsFull: Number(option('--runs-full', '5')),
    });
    const text = `${verdict.lines.join('\n')}\n`;
    process.stdout.write(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    if (!verdict.green) process.exit(1);
    return;
  }
  throw new Error(
    'Usage: translate-timing.mjs make <folder> [--size tiny|full] | proof <helper> --work <folder> [--runs-tiny N] [--runs-full N]',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
