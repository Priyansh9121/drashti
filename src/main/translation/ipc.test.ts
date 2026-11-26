import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeHelper } from '../testing/fake-translate-helper';
import { INDICTRANS2_FILES, INDICTRANS2_FORMAT, TranslationEngine } from './translation-engine';
import { HelperError, TranslationHelper } from './translation-helper';
import {
  LIVE_CAPTIONS,
  NOT_HERE,
  NOT_INSTALLED,
  NO_MODEL,
  ON_AIR,
  READY,
  UNKNOWN_MODEL,
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
    engine: {
      installed: () => true,
      available: () => true,
      unknownModel: () => false,
      translate,
      cancel,
      ...engine,
    },
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
            files: INDICTRANS2_FILES.map((name) => ({
              name,
              path: `/p/en-indic/${name}`,
              sha256: '0'.repeat(64),
            })),
          },
        ],
        acquire: () => Promise.resolve({ release: () => undefined }),
      },
      // A stand-in model, not x74's conversion: taken as known here, its folder (not on this disk) the five files.
      checkFiles: () => true,
      listFolder: () => Promise.resolve([...INDICTRANS2_FILES]),
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
    const { call } = setUp(
      {},
      {
        installed: () => engine.installed(),
        available: (from, to) => engine.available(from, to),
        unknownModel: (from, to) => engine.unknownModel(from, to),
        translate: (source, from, to) => engine.translate(source, from, to),
        cancel: () => {
          engine.cancel();
        },
      },
    );
    const result = await call(IPC.slideEditor.translationDraft, request);
    // What stopped it is for the log; the operator gets the one next step alpha.21's notices give (review nit).
    expect(result).toEqual({
      ok: false,
      message:
        'The translation engine stopped. If it happens again, choose Help \u203a Report a Problem\u2026 (or Help \u203a Save Diagnostics).',
    });
    expect(log.warn).toHaveBeenCalledWith('Translation: the engine stopped (exit 139).');
    engine.stop();
  });

  it('says when the pack holds a translation model this Drashti does not know (a22-review-mt A14)', async () => {
    const { call, translate } = setUp({}, { available: () => false, unknownModel: () => true });
    await expect(call(IPC.slideEditor.translationStatus, 'en', 'gu')).resolves.toEqual({
      installed: true,
      available: false,
      message: UNKNOWN_MODEL,
    });
    await expect(call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: UNKNOWN_MODEL,
    });
    expect(translate).not.toHaveBeenCalled();
  });

  it('says the stream went on air when that is what stopped a draft (review nit)', async () => {
    let air = false;
    const { call } = setUp(
      { onAir: () => air },
      {
        translate: () => {
          air = true;
          return Promise.reject(new HelperError('cancelled', 'Stopped.'));
        },
      },
    );
    await expect(call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: ON_AIR,
    });
  });

  it('waits while translated live captions run, as on air (lead 2’s decision a: never two helpers at once)', async () => {
    let live = true;
    const { call, translate } = setUp({ liveCaptions: () => live });
    await expect(call(IPC.slideEditor.translationStatus, 'en', 'gu')).resolves.toMatchObject({
      available: true,
      message: LIVE_CAPTIONS,
    });
    await expect(call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: LIVE_CAPTIONS,
    });
    expect(translate).not.toHaveBeenCalled();
    expect(LIVE_CAPTIONS).toMatch(/translated live captions/u);
    // Stopped because translated captions began: says that, not just "Stopped".
    live = false;
    const stopped = setUp(
      { liveCaptions: () => live },
      {
        translate: vi.fn(() => {
          live = true;
          return Promise.reject(new HelperError('cancelled', 'Stopped.'));
        }),
      },
    );
    await expect(stopped.call(IPC.slideEditor.translationDraft, request)).resolves.toEqual({
      ok: false,
      message: LIVE_CAPTIONS,
    });
  });
});
