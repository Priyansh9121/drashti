import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeIndicFixture } from '../../scripts/indic-fixture.mjs';
import { createIndicEngine } from '../../src/main/speech/indic-engine';
import { routeCFiles } from '../../src/main/speech/indic-protocol';
import { createSpeechHub } from '../../src/main/speech/hub';
import type { Heard } from '../../src/shared/speech';

// Native process -> real speech engine -> real hub. Generated model/PCM only, no recording, microphone or download.
// cap-integration's captions-ai spec covers the downstream coordinator and screen routing.
test('imported Route C model decodes PCM through the native helper into the speech hub', async (_fixtures, info) => {
  const root = info.outputPath('આકાર fixture');
  mkdirSync(root, { recursive: true });
  const fixture = makeIndicFixture();
  const files = [
    { name: 'model.onnx', data: fixture.model },
    { name: 'tokens.txt', data: fixture.tokens },
    { name: 'frontend.bin', data: fixture.frontend },
  ].map(({ name, data }) => {
    const path = join(root, name);
    writeFileSync(path, data);
    return { name, path };
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
  const engine = createIndicEngine({
    workGate: { allowed: () => true, listen: () => () => undefined },
    program: () =>
      join(
        process.cwd(),
        'vendor',
        'indic',
        `${process.platform}-${process.arch}`,
        process.platform === 'win32' ? 'ic-ctc.exe' : 'ic-ctc',
      ),
    acquire: () => ({ files: resolved, release: () => release?.() }),
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
