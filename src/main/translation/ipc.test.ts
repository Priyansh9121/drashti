import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeHelper } from '../testing/fake-translate-helper';
import { INDICTRANS2_FILES, INDICTRANS2_FORMAT, TranslationEngine } from './translation-engine';
import { HelperError, TranslationHelper } from './translation-helper';
import {
  NOT_HERE,
  NOT_INSTALLED,
  NO_MODEL,
  ON_AIR,
  READY,
  handleTranslation,
  type TranslationIpcDeps,
} from './ipc';

function setUp(over: Partial<TranslationIpcDeps> = {}, engine: Partial<TranslationIpcDeps['engine']> = {}) {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const translate = vi.fn(() => Promise.resolve('Placeholder draft'));
  const cancel = vi.fn();
  handleTranslation({
    handle: (channel, handler) => handlers.set(channel, handler),
    mayDraft: () => true,
    onAir: () => false,
    engine: { installed: () => true, available: () => true, translate, cancel, ...engine },
    ...over,
  });
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)?.({} as IpcMainInvokeEvent, ...args));
  return { call, translate, cancel };
}
const request = { source: 'Placeholder source.', from: 'en', to: 'gu' };

describe('Prepare translations’ requests', () => {
  it('drafts one text box and hands the words back to the dialog only', async () => {
    const { call, translate } = setUp();
    await expect(call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: true,
      text: 'Placeholder draft',
    });
    expect(translate).toHaveBeenCalledWith('Placeholder source.', 'en', 'gu');
    await expect(call(IPC.slideEditor.translationStatus, 'en', 'gu')).resolves.toEqual({
      installed: true,
      available: true,
      message: READY,
    });
  });

  it('refuses outside Pro Mode’s editor or operator window, and malformed requests, before the engine starts', async () => {
    const outside = setUp({ mayDraft: () => false });
    await expect(outside.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: NOT_HERE,
    });
    await expect(outside.call(IPC.slideEditor.translationCancel)).resolves.toBe(false);
    expect(outside.translate).not.toHaveBeenCalled();
    const inside = setUp();
    for (const bad of [
      null,
      'x',
      { ...request, from: 'fr' },
      { ...request, to: 'en', from: 'en' },
      { ...request, source: 7 },
      { ...request, source: 'x'.repeat(20_001) },
    ])
      await expect(inside.call(IPC.slideEditor.translationDraft, bad)).resolves.toMatchObject({ ok: false });
    expect(inside.translate).not.toHaveBeenCalled();
  });

  it('waits while the stream is on air or recording', async () => {
    const { call, translate } = setUp({ onAir: () => true });
    await expect(call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: ON_AIR,
    });
    await expect(call(IPC.slideEditor.translationStatus, 'en', 'gu')).resolves.toMatchObject({
      message: ON_AIR,
    });
    expect(translate).not.toHaveBeenCalled();
  });

  it('says plainly when this copy has no engine, or the pack no model for the direction', async () => {
    const none = setUp({}, { installed: () => false, available: () => false });
    await expect(none.call(IPC.slideEditor.translationStatus, 'en', 'gu')).resolves.toEqual({
      installed: false,
      available: false,
      message: NOT_INSTALLED,
    });
    await expect(none.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: NOT_INSTALLED,
    });
    const noModel = setUp({}, { available: () => false });
    await expect(noModel.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: NO_MODEL,
    });
  });

  it('marks a failure that is this box’s alone, so the dialog goes on with the next box', async () => {
    const long = setUp({}, { translate: () => Promise.reject(new HelperError('too-long', 'Too long.')) });
    await expect(long.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: 'Too long.',
      thisBoxOnly: true,
    });
    const ended = setUp({}, { translate: () => Promise.reject(new HelperError('ended', 'Stopped engine.')) });
    await expect(ended.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: 'Stopped engine.',
    });
  });

  it('Stop cancels the engine', async () => {
    const { call, cancel } = setUp();
    await expect(call(IPC.slideEditor.translationCancel)).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('says only that the engine stopped when the helper dies (an Intel Mac where it cannot run): no other advice', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const engine = new TranslationEngine({
      program: () => '/x/drashti-translate',
      log,
      models: {
        forPurpose: () => [
          {
            id: 'en-indic',
            format: INDICTRANS2_FORMAT,
            files: INDICTRANS2_FILES.map((name) => ({ name, path: `/p/en-indic/${name}` })),
          },
        ],
        acquire: () => Promise.resolve({ release: () => undefined }),
      },
      createHelper: (program) =>
        new TranslationHelper({
          program,
          log,
          lowerPriority: () => undefined,
          spawn: () =>
            fakeHelper((r, child) => {
              if (r['op'] !== 'translate') return `{"id":${String(r['id'])},"ok":true}`;
              child.emit('exit', 139);
              return null;
            }),
        }),
    });
    const { call } = setUp({}, engine);
    const result = await call(IPC.slideEditor.translationDraft, request);
    expect(result).toEqual({ ok: false, message: 'The translation engine stopped.' });
    expect(log.warn).toHaveBeenCalledWith('Translation: the engine stopped (exit 139).');
    engine.stop();
  });
});
