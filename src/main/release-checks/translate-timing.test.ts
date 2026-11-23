import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkflow } from '../../../scripts/check-workflows.mjs';
import {
  FIXTURE_DIR,
  FIXTURE_FILES,
  FIXTURE_SHA256,
  LIMIT_MS,
  SENTENCE,
  SENTENCE_PIECES,
  hashModel,
  judge,
  modelLayout,
  readCt2Log,
  readSample,
  readSystem,
  checkModel,
  timeModel,
} from '../../../scripts/translate-timing.mjs';

/*
 * The translation engine's Intel Mac proof without a model pack (alpha.23, a22-intel; a22-review-mt A2): one
 * hand-started job on GitHub's Intel Mac runner builds drashti-translate natively, reads which instruction set
 * CTranslate2 dispatches to and which kernel ruy runs, and times GENERATED models only: the tiny one committed in
 * tests/fixtures/translation/timing-model/ and a full-size one made on the runner by the same script. Never a real
 * model: the timing refuses any folder that is not byte for byte what the script generates.
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-timing-test-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const copyFixture = () => {
  const dir = temp();
  for (const f of FIXTURE_FILES) copyFileSync(join(root, FIXTURE_DIR, f), join(dir, f));
  return dir;
};

describe('the generated timing models (never a real one)', () => {
  it('commits the tiny model as a fixture of a few KB, byte for byte what the script generates', () => {
    const dir = join(root, FIXTURE_DIR);
    expect(readdirSync(dir).sort()).toEqual([...FIXTURE_FILES].sort());
    for (const f of FIXTURE_FILES) expect(sha256(join(dir, f)), f).toBe(FIXTURE_SHA256.tiny[f]);
    expect(hashModel('tiny')).toEqual(FIXTURE_SHA256.tiny);
    expect(readFileSync(join(dir, 'model.bin')).length).toBeLessThan(16 * 1024);
  });

  it('generates the full-size model as the real IndicTrans2 conversion is laid out: 803 variables, 2 aliases', () => {
    const { variables, aliases } = modelLayout('full');
    expect(variables).toHaveLength(803);
    expect(aliases).toEqual([
      ['decoder/projection/weight', 'decoder/embeddings/weight'],
      ['encoder/position_encodings/encodings', 'decoder/position_encodings/encodings'],
    ]);
    const shape = (name: string) => variables.find((v) => v.name === name);
    expect(shape('decoder/embeddings/weight')).toMatchObject({ dims: [122672, 512], type: 'int8' });
    expect(shape('encoder/embeddings_0/weight')).toMatchObject({ dims: [32322, 512], type: 'int8' });
    expect(shape('encoder/layer_17/ffn/linear_0/weight')).toMatchObject({ dims: [2048, 512], type: 'int8' });
    expect(shape('decoder/layer_17/attention/linear_1/weight')).toMatchObject({
      dims: [1024, 512],
      type: 'int8',
    });
    expect(shape('decoder/position_encodings/encodings')).toMatchObject({
      dims: [256, 512],
      type: 'float32',
    });
    expect(shape('encoder/layer_18/ffn/linear_0/weight')).toBeUndefined();
    // The full-size model's recorded hashes are what the generator makes (about 215 MB, never written here).
    expect(hashModel('full')).toEqual(FIXTURE_SHA256.full);
  });

  it('tokenises the placeholder sentence into pieces the source vocabulary holds', () => {
    expect(SENTENCE).toBe('The engine reads this short sentence and writes another one in its place.');
    expect(SENTENCE_PIECES).toEqual(SENTENCE.split(' ').map((w) => `▁${w}`));
    const vocabulary = JSON.parse(
      readFileSync(join(root, FIXTURE_DIR, 'source_vocabulary.json'), 'utf8'),
    ) as string[];
    for (const piece of [...SENTENCE_PIECES, 'eng_Latn', 'guj_Gujr', '</s>'])
      expect(vocabulary, piece).toContain(piece);
  });

  it('refuses a folder that is not the generated model: a changed byte, a file missing or added, the wrong size', async () => {
    expect(checkModel(copyFixture(), 'tiny')).toEqual([]);
    const changed = copyFixture();
    const model = readFileSync(join(changed, 'model.bin'));
    model[model.length - 40] = (model[model.length - 40] ?? 0) ^ 1;
    writeFileSync(join(changed, 'model.bin'), model);
    expect(checkModel(changed, 'tiny')).toEqual(['model.bin is not the generated tiny model’s']);
    const missing = copyFixture();
    rmSync(join(missing, 'source.spm'));
    expect(checkModel(missing, 'tiny')).toEqual(['source.spm is missing']);
    const added = copyFixture();
    writeFileSync(join(added, 'shared_vocabulary.json'), '[]\n');
    expect(checkModel(added, 'tiny')).toEqual(['shared_vocabulary.json is not part of the generated model']);
    expect(checkModel(copyFixture(), 'full')).toHaveLength(FIXTURE_FILES.length);
    // Refused before any program starts: this "helper" does not exist, so starting it would fail otherwise.
    await expect(timeModel('/nonexistent/drashti-translate', changed, 'tiny', [])).rejects.toThrow(
      /is not the generated tiny model: model\.bin is not the generated tiny model’s/u,
    );
  });
});

describe('what the proof reads', () => {
  it('reads CTranslate2’s own words (CT2_VERBOSE=1): the CPU, the instruction set it dispatches to, the int8 backend', () => {
    const log = [
      '[2026-11-24 10:00:00.001] [ctranslate2] [thread 1] [info] CPU: GenuineIntel (SSE4.1=true, AVX=true, AVX2=true, AVX512=false)',
      '[2026-11-24 10:00:00.001] [ctranslate2] [thread 1] [info]  - Selected ISA: AVX2',
      '[2026-11-24 10:00:00.001] [ctranslate2] [thread 1] [info]  - Use Intel MKL: false',
      '[2026-11-24 10:00:00.001] [ctranslate2] [thread 1] [info]  - SGEMM backend: Accelerate (packed: false)',
      '[2026-11-24 10:00:00.001] [ctranslate2] [thread 1] [info]  - GEMM_S8 backend: Ruy (packed: false, u8s8 preferred: false)',
    ].join('\n');
    expect(readCt2Log(log)).toEqual({
      cpu: 'GenuineIntel (SSE4.1=true, AVX=true, AVX2=true, AVX512=false)',
      isa: 'AVX2',
      gemm8: 'Ruy',
    });
    expect(readCt2Log('nothing')).toEqual({ cpu: null, isa: null, gemm8: null });
  });

  it('reads the processor’s features from sysctl (Intel) or its Arm features', () => {
    expect(
      readSystem('x64', {
        'machdep.cpu.brand_string': 'Intel(R) Core(TM) i7-8700B CPU @ 3.20GHz',
        'machdep.cpu.features': 'FPU VME SSE SSE2 SSE3 SSSE3 FMA SSE4.1 SSE4.2 AVX1.0',
        'machdep.cpu.leaf7_features': 'RDWRFSGS BMI1 AVX2 SMEP BMI2 ERMS',
      }),
    ).toEqual({
      arch: 'x64',
      brand: 'Intel(R) Core(TM) i7-8700B CPU @ 3.20GHz',
      avx: true,
      avx2: true,
      fma: true,
      avx512f: false,
      dotprod: false,
    });
    expect(readSystem('arm64', { 'machdep.cpu.brand_string': 'Apple M5', 'hw.optional.arm.FEAT_DotProd': '1' }))
      .toMatchObject({ arch: 'arm64', avx2: false, dotprod: true });
  });

  it('counts which ruy kernel ran from a sample of the helper (top of stack)', () => {
    const sample = [
      'Call graph:',
      '    2400 Thread_1   DispatchQueue_1: com.apple.main-thread  (serial)',
      '',
      'Sort by top of stack, same collapsed (when >= 5):',
      '        ruy::Kernel8bitAvx2(ruy::KernelParams8bit<8, 8> const&)  (in drashti-translate)        1520',
      '        ruy::Kernel8bitAvx2SingleCol(ruy::KernelParams8bit<8, 8> const&)  (in drashti-translate)        80',
      '        ruy::Kernel8bitAvx512(ruy::KernelParams8bit<16, 16> const&)  (in drashti-translate)        7',
      '        void ruy::Kernel<(ruy::Path)1, signed char, signed char, int, signed char>::Run()  (in drashti-translate)        3',
      '        ruy::Kernel8bitNeonDotprod(ruy::KernelParams8bit<8, 8> const&)  (in drashti-translate)        9',
      '        __psynch_cvwait  (in libsystem_kernel.dylib)        900',
      '',
      'Binary Images:',
    ].join('\n');
    expect(readSample(sample)).toEqual({ avx512: 7, avx2: 1600, avx: 0, neon: 9, standard: 3 });
    expect(readSample('')).toEqual({ avx512: 0, avx2: 0, avx: 0, neon: 0, standard: 0 });
  });
});

describe('the verdict', () => {
  const good = {
    system: {
      arch: 'x64',
      brand: 'Intel',
      avx: true,
      avx2: true,
      fma: true,
      avx512f: false,
      dotprod: false,
    },
    symbols: { avx2: true, avx512: true, neon: false },
    ct2: { cpu: 'GenuineIntel', isa: 'AVX2', gemm8: 'Ruy' },
    sample: { avx512: 0, avx2: 1600, avx: 0, neon: 0, standard: 0 },
    sampleError: null,
    tiny: { ok: true, problems: [], runs: [{ beam: 1, ms: [3, 4], tokens: [256, 256] }] },
    full: {
      ok: true,
      problems: [],
      runs: [
        { beam: 1, ms: [4000, 4100], tokens: [256, 256] },
        { beam: 5, ms: [9000, 9500], tokens: [256, 256] },
      ],
    },
  };

  it('is green on an Intel Mac when CTranslate2 dispatches to AVX2 or better and ruy runs its AVX kernel in time', () => {
    const v = judge(good);
    expect(v.problems).toEqual([]);
    expect(v.green).toBe(true);
    expect(v.lines.join('\n')).toContain('GREEN');
    expect(v.lines.join('\n')).toContain('AVX2');
    expect(judge({ ...good, ct2: { ...good.ct2, isa: 'AVX512' } }).green).toBe(true);
  });

  it('is red for the generic or AVX-only dispatch, ruy’s reference kernel, a missing kernel, a failed run, or too slow', () => {
    expect(judge({ ...good, ct2: { ...good.ct2, isa: 'GENERIC' } }).problems).toEqual([
      'CTranslate2 dispatches to GENERIC, not AVX2 or better',
    ]);
    expect(judge({ ...good, ct2: { ...good.ct2, isa: 'AVX' } }).green).toBe(false);
    expect(judge({ ...good, ct2: { ...good.ct2, gemm8: 'none' } }).problems).toEqual([
      'the int8 products run on none, not ruy',
    ]);
    expect(judge({ ...good, symbols: { avx2: false, avx512: false, neon: false } }).problems).toEqual([
      'ruy’s AVX2 kernel is not in the program (its x86 fast paths are compiled out)',
    ]);
    expect(
      judge({ ...good, sample: { avx512: 0, avx2: 0, avx: 0, neon: 0, standard: 1200 } }).problems,
    ).toEqual(['ruy ran its reference C++ kernel while translating (1200 samples), never an AVX one']);
    expect(judge({ ...good, tiny: { ...good.tiny, ok: false, problems: ['load: model-unreadable'] } }).problems).toEqual([
      'tiny model: load: model-unreadable',
    ]);
    const slow = { ...good.full, runs: [good.full.runs[0], { beam: 5, ms: [9000, LIMIT_MS + 1], tokens: [256, 256] }] };
    expect(judge({ ...good, full: slow }).problems).toEqual([
      `a full-size sentence took ${String(LIMIT_MS + 1)} ms with the careful search (beam 5): over the app’s ${String(LIMIT_MS)} ms`,
    ]);
    expect(judge({ ...good, system: { ...good.system, avx2: false } }).green).toBe(false);
  });

  it('says plainly when no sample could be taken, and judges by the rest', () => {
    const v = judge({ ...good, sample: null, sampleError: 'sample could not attach' });
    expect(v.green).toBe(true);
    expect(v.lines.join('\n')).toContain('not sampled (sample could not attach)');
  });

  it('judges an Apple silicon run by NEON, for comparison', () => {
    const arm = {
      ...good,
      system: { ...good.system, arch: 'arm64', avx: false, avx2: false, fma: false, dotprod: true },
      symbols: { avx2: false, avx512: false, neon: true },
      ct2: { cpu: 'ARM', isa: 'NEON', gemm8: 'Ruy' },
      sample: { avx512: 0, avx2: 0, avx: 0, neon: 900, standard: 0 },
    };
    expect(judge(arm).problems).toEqual([]);
  });
});

describe('the one hand-started Intel job (performance.yml)', () => {
  const workflow = read('.github/workflows/performance.yml');
  const job = workflow.split('\n  translate-intel:\n')[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? '';

  it('is an input of the dispatchable performance workflow, off unless asked', () => {
    expect(workflow).toMatch(
      /\n {6}translate_intel:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: false\n/u,
    );
    expect(job).toContain('    if: inputs.translate_intel\n');
    // The ordinary performance check is unchanged, and skipped when the Intel job is asked for (one job only).
    expect(workflow).toMatch(/\n {2}performance:\n {4}name: [^\n]+\n {4}if: \$\{\{ !inputs\.translate_intel \}\}\n/u);
  });

  it('runs on GitHub’s free Intel Mac runner and builds the engine natively, as the release names it', () => {
    expect(job).toContain('    runs-on: macos-15-intel\n');
    expect(job).toContain('run: node scripts/fetch-translate.mjs --target darwin-x64\n');
    expect(job).toContain('sysctl machdep.cpu.features machdep.cpu.leaf7_features');
    expect(job).toContain(
      'run: node scripts/translate-timing.mjs proof vendor/translate/darwin-x64/drashti-translate --work "$RUNNER_TEMP/translate-timing"\n',
    );
    // Nothing installed but Node: no pnpm install, no model pack, no cache.
    expect(job).not.toMatch(/pnpm|actions\/cache|model-pack|\.mcp/u);
    expect(checkWorkflow(workflow, 'performance.yml')).toEqual([]);
  });
});
