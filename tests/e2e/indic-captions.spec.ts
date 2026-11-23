import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { makeIndicFixture } from '../../scripts/indic-fixture.mjs';
import { createIndicRoute } from '../../src/main/speech/indic-route';
import { routeCFiles } from '../../src/main/speech/indic-protocol';
import { createSpeechHub } from '../../src/main/speech/hub';
import type { Heard } from '../../src/shared/speech';

// Native process -> real speech engine -> real hub. Generated model/PCM only, no recording, microphone or download.
// cap-integration's captions-ai spec covers the downstream coordinator and screen routing.
for (const policy of ['protected', 'below-show'] as const) {
  test(`checked Route C model decodes PCM through native helper and speech hub (${policy})`, async () => {
    const root = test.info().outputPath('આકાર fixture');
    mkdirSync(root, { recursive: true });
    const fixture = makeIndicFixture({ trailingSeparator: policy === 'below-show' });
    const files = [
      { name: 'model.onnx', data: fixture.model },
      { name: 'tokens.txt', data: fixture.tokens },
      { name: 'frontend.bin', data: fixture.frontend },
    ].map(({ name, data }) => {
      const path = join(root, name);
      writeFileSync(path, data);
      return { name, path, sha256: createHash('sha256').update(data).digest('hex') };
    });
    const pack = { format: 'indicconformer-ctc-onnx-v1', purposes: ['captions-gu'], files };
    const resolved = routeCFiles(pack, 'gu');
    expect(resolved).not.toBeNull();
    if (!resolved) throw new Error('Generated pack files missing');
    let sound: ((samples: Int16Array, endAt: number, startAt?: number) => void) | undefined;
    let soundClosed = false;
    let ready: (() => void) | undefined, release: (() => void) | undefined;
    const listening = new Promise<void>((done) => {
      ready = done;
    });
    const released = new Promise<void>((done) => {
      release = done;
    });
    const admission =
      policy === 'protected'
        ? { workGate: { allowed: () => true, listen: () => () => undefined } }
        : { admission: 'below-show' as const };
    const route = createIndicRoute({
      ...admission,
      program: () =>
        join(
          process.cwd(),
          'vendor',
          'indic',
          `${process.platform}-${process.arch}`,
          process.platform === 'win32' ? 'ic-ctc.exe' : 'ic-ctc',
        ),
      store: {
        model: (id) => (id === 'generated' ? pack : null),
        acquire: (id) =>
          Promise.resolve(id === 'generated' ? { model: pack, release: () => release?.() } : null),
      },
      sound: {
        open: (to) => {
          sound = to;
          return () => {
            soundClosed = true;
          };
        },
      },
      log: { info: () => undefined, warn: () => undefined },
    });
    const engine = route.make({ ...pack, id: 'generated' }, 'gu');
    expect(engine).not.toBeNull();
    if (!engine) throw new Error('Generated recognition route missing');
    const hub = createSpeechHub({ engine, log: { info: () => undefined, warn: () => undefined } });
    const phrases: Heard[] = [];
    let heard: ((phrase: Heard) => void) | undefined;
    const final = new Promise<Heard>((done) => {
      heard = done;
    });
    const unwatch = hub.onState((state) => {
      if (state.phase === 'listening') ready?.();
    });
    const unlisten = hub.listen('generated-route-c', (phrase) => {
      phrases.push(phrase);
      if (phrase.final) heard?.(phrase);
    });
    try {
      expect(hub.state()).toEqual({ phase: 'off' });
      expect(sound).toBeUndefined();
      hub.setLanguage('gu');
      hub.setOn(true);
      await listening;
      const start = Date.now() - 800;
      sound?.(new Int16Array(1600).fill(5000), start + 100, start);
      for (let i = 1; i <= 7; i += 1) sound?.(new Int16Array(1600), start + (i + 1) * 100, start + i * 100);
      const phrase = await final;
      expect(phrase.text).toBe('shape shape box');
      expect(phrase.language).toBe('gu');
      expect(phrase.words.map((word) => word.confidence)).toEqual([null, null, null]);
      expect(phrase.startAt).toBe(start);
      expect(phrase.endAt).toBe(start + 200);
      expect(phrases).toHaveLength(1);
      hub.close();
      await released;
      expect(soundClosed).toBe(true);
      expect(hub.state()).toEqual({ phase: 'off' });
    } finally {
      unlisten();
      unwatch();
      hub.close();
    }
  });
}
