import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { HelperChild } from '../translation/translation-helper';

// Tests only: a stand-in for drashti-translate (alpha.22) that never runs a model.

/** A stand-in for drashti-translate: it reads the JSON lines Drashti sends and answers as `answer` says. */
export function fakeHelper(
  answer: (request: Record<string, unknown>, child: FakeChild) => string | string[] | null,
  hello = '{"hello":"drashti-translate","protocol":1,"ctranslate2":"4.9.1","sentencepiece":"0.2.1"}',
): FakeChild {
  const child = new FakeChild();
  setImmediate(() => {
    if (hello) child.stdout.write(`${hello}\n`);
  });
  let pending = '';
  child.stdin.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const request = JSON.parse(pending.slice(0, at)) as Record<string, unknown>;
      pending = pending.slice(at + 1);
      child.requests.push(request);
      const reply = answer(request, child);
      for (const line of reply === null ? [] : Array.isArray(reply) ? reply : [reply])
        child.stdout.write(`${line}\n`);
    }
  });
  return child;
}

export class FakeChild extends EventEmitter implements HelperChild {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  killed = false;
  requests: Record<string, unknown>[] = [];
  kill(): boolean {
    this.killed = true;
    this.emit('exit', null);
    return true;
  }
}
