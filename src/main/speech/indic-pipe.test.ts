import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { openIndicPipe } from './indic-pipe';

function child() {
  const p = new EventEmitter();
  const kill = vi.fn();
  const process = Object.assign(p, {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill,
    pid: 123,
    exitCode: null,
  }) as unknown as ChildProcess;
  return { process, kill };
}
const files = { model: '/pack/model.onnx', tokens: '/pack/tokens.txt', frontend: '/pack/frontend.bin' };

describe('the supervised recogniser pipe', () => {
  it('waits for readiness, sends PCM, accepts one answer and kills on close', async () => {
    const { process: p, kill } = child();
    const spawn = vi.fn((_program: string, _args: string[]) => p);
    const opening = openIndicPipe({
      program: '/helper',
      files,
      language: 'gu',
      spawn,
      priority: () => undefined,
    });
    p.stdout?.emit(
      'data',
      Buffer.from(
        '{"ready":true,"protocolVersion":1,"sampleRate":16000,"channels":1,"sampleFormat":"s16le"}\n',
      ),
    );
    const pipe = await opening;
    expect(spawn.mock.calls[0]?.[1]).toContain('--pcm-serve');
    expect(spawn.mock.calls[0]?.[1]).toContain('--admit');
    expect((p.stdin as PassThrough).read() as unknown).toEqual(Buffer.from('GO01'));
    const request = pipe.decode(new Int16Array([1, 2]));
    expect(() => pipe.decode(new Int16Array([3]))).toThrow('busy');
    p.stdout?.emit('data', Buffer.from('{"language":"gu","words":[]}\n'));
    await expect(request).resolves.toEqual({ language: 'gu', words: [] });
    pipe.close();
    expect(kill).toHaveBeenCalledOnce();
  });
  it('rejects pending work when stopped, then ignores a late answer', async () => {
    const { process: p } = child();
    const opening = openIndicPipe({
      program: '/helper',
      files,
      language: 'hi',
      spawn: () => p,
      priority: () => undefined,
    });
    p.stdout?.emit(
      'data',
      Buffer.from(
        '{"ready":true,"protocolVersion":1,"sampleRate":16000,"channels":1,"sampleFormat":"s16le"}\n',
      ),
    );
    const pipe = await opening;
    const request = pipe.decode(new Int16Array([1]));
    const rejected = expect(request).rejects.toThrow('closed');
    pipe.close();
    p.stdout?.emit('data', Buffer.from('{"language":"hi","words":[]}\n'));
    await rejected;
  });
  it('fails closed for oversized output or missing below-show priority', async () => {
    const { process: p, kill } = child();
    const opening = openIndicPipe({
      program: '/helper',
      files,
      language: 'hi',
      spawn: () => p,
      priority: () => undefined,
    });
    const rejected = expect(opening).rejects.toThrow('protocol');
    p.stdout?.emit('data', Buffer.alloc(65537, 32));
    await rejected;
    expect(kill).toHaveBeenCalledOnce();
    const { process: q, kill: killQ } = child();
    await expect(
      openIndicPipe({
        program: '/helper',
        files,
        language: 'hi',
        spawn: () => q,
        priority: () => {
          throw new Error('priority');
        },
      }),
    ).rejects.toThrow('priority');
    expect(killQ).toHaveBeenCalledOnce();
  });
});
