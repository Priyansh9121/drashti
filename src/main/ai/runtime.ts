import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AI_MODEL } from '../../shared/ai';
interface TensorValue {
  dims: readonly number[];
  data: Float32Array;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, TensorValue>>;
  release(): Promise<void>;
}
interface OrtApi {
  Tensor: new (type: 'int64', data: BigInt64Array, dimensions: number[]) => unknown;
  InferenceSession: { create(file: string, options: unknown): Promise<OrtSession> };
}
interface TokenizerApi {
  Tokenizer: new (json: unknown, config: unknown) => { encode(text: string): { ids: number[] } };
}
async function verified(file: string, bytes: number, expected: string): Promise<void> {
  const info = await stat(file);
  if (!info.isFile() || info.size !== bytes) throw new Error('MODEL_UNAVAILABLE');
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  if (hash.digest('hex') !== expected) throw new Error('MODEL_UNAVAILABLE');
}
/** Encoder only. It returns numbers; it has no text-generation or network path. */
export class MeaningEncoder {
  private session: OrtSession | null = null;
  private api: OrtApi | null = null;
  private tokenizer: InstanceType<TokenizerApi['Tokenizer']> | null = null;
  private loading: Promise<void> | null = null;
  /** Derived numbers only, shared by every job in this worker; source validation still belongs to Main. */
  private readonly vectors = new Map<string, Float32Array>();
  constructor(private readonly root: string) {}
  private async load(): Promise<void> {
    if (this.session) return;
    this.loading ??= (async () => {
      const model = join(this.root, 'models', 'multilingual-e5-small');
      for (const [name, pin] of Object.entries(AI_MODEL.files))
        await verified(join(model, name), pin.bytes, pin.sha256);
      const requireAsset = createRequire(__filename);
      const ort = requireAsset(join(this.root, 'runtime', 'node_modules', 'onnxruntime-node')) as OrtApi;
      const tokenizers = requireAsset(join(this.root, 'runtime', 'tokenizers.cjs')) as TokenizerApi;
      this.tokenizer = new tokenizers.Tokenizer(
        JSON.parse(await readFile(join(model, 'tokenizer.json'), 'utf8')) as unknown,
        JSON.parse(await readFile(join(model, 'tokenizer_config.json'), 'utf8')) as unknown,
      );
      this.api = ort;
      this.session = await ort.InferenceSession.create(join(model, 'model.onnx'), {
        executionProviders: ['cpu'],
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        executionMode: 'sequential',
        enableCpuMemArena: false,
        enableMemPattern: false,
        logSeverityLevel: 4,
        extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
      });
    })();
    await this.loading;
  }
  async embed(text: string, role: 'query' | 'passage'): Promise<Float32Array> {
    const key = role + ':' + createHash('sha256').update(text).digest('hex');
    const cached = this.vectors.get(key);
    if (cached) {
      this.vectors.delete(key);
      this.vectors.set(key, cached);
      return cached.slice();
    }
    await this.load();
    const session = this.session;
    const api = this.api;
    const tokenizer = this.tokenizer;
    if (!session || !api || !tokenizer) throw new Error('MODEL_UNAVAILABLE');
    const encoded = tokenizer.encode(role + ': ' + text).ids;
    const ids = encoded.slice(0, 128);
    if (encoded.length > 128) ids[127] = encoded.at(-1) ?? 2;
    if (!ids.length) throw new Error('MODEL_UNAVAILABLE');
    const feeds: Record<string, unknown> = {};
    for (const name of session.inputNames) {
      const values =
        name === 'input_ids'
          ? ids
          : name === 'attention_mask'
            ? ids.map(() => 1)
            : name === 'token_type_ids'
              ? ids.map(() => 0)
              : null;
      if (!values) throw new Error('MODEL_UNAVAILABLE');
      feeds[name] = new api.Tensor('int64', BigInt64Array.from(values, BigInt), [1, ids.length]);
    }
    const output = (await session.run(feeds))[session.outputNames[0] ?? ''];
    if (
      !output ||
      !(output.data instanceof Float32Array) ||
      output.dims.length !== 3 ||
      output.dims[0] !== 1 ||
      output.dims[1] !== ids.length ||
      output.dims[2] !== AI_MODEL.dimensions
    )
      throw new Error('MODEL_UNAVAILABLE');
    const mean = new Float64Array(AI_MODEL.dimensions);
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < mean.length; j++)
        mean[j] = (mean[j] ?? 0) + (output.data[i * mean.length + j] ?? 0) / ids.length;
    const norm = Math.hypot(...mean);
    if (!Number.isFinite(norm) || norm <= 0) throw new Error('MODEL_UNAVAILABLE');
    const vector = Float32Array.from(mean, (value) => value / norm);
    if (!vector.every(Number.isFinite)) throw new Error('MODEL_UNAVAILABLE');
    if (session === this.session) {
      this.vectors.set(key, vector.slice());
      if (this.vectors.size > 256) {
        const oldest = this.vectors.keys().next().value;
        if (oldest !== undefined) this.vectors.delete(oldest);
      }
    }
    return vector;
  }
  async close(): Promise<void> {
    this.vectors.clear();
    await this.session?.release();
    this.session = null;
    this.tokenizer = null;
    this.api = null;
    this.loading = null;
  }
}
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== AI_MODEL.dimensions || b.length !== a.length) return -1;
  let value = 0;
  for (let i = 0; i < a.length; i++) value += (a[i] ?? 0) * (b[i] ?? 0);
  return value;
}
