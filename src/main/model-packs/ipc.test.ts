import type { IpcMainInvokeEvent } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { SIMPLE_MODE_LOCKED, simpleModeRefusals } from '../simple-mode';
import { handleModelPacks, NOT_THE_OPERATOR, NOTHING_CHOSEN } from './ipc';
import { ModelPackStore } from './store';

/*
 * Help › Caption and Translation Models…'s requests (alpha.22, cap-pack): the operator window's only, Pro Mode's
 * (Simple Mode's lock refuses them), the pack chosen in main's own dialog. An empty data folder: no pack.
 */

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function harness(picked: string | null = null) {
  const data = mkdtempSync(join(tmpdir(), 'drashti-model-packs-ipc-'));
  made.push(data);
  const store = new ModelPackStore({ root: join(data, 'model-packs'), log: { info: vi.fn(), warn: vi.fn() } });
  store.start();
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const pick = vi.fn((_kind: 'folder' | 'zip') => Promise.resolve(picked));
  handleModelPacks({
    handle: (channel, handler) => {
      handlers.set(channel, handler as (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
    },
    fromOperator: (e) => (e as unknown as { operator: boolean }).operator,
    store,
    pick,
  });
  const ask = (operator: boolean, channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)?.({ operator } as unknown as IpcMainInvokeEvent, ...args));
  return { store, pick, ask, handlers };
}

const NONE = { packs: [], importing: { phase: 'idle' }, problem: null };

describe('the caption and translation models’ requests (alpha.22, cap-pack)', () => {
  it('answers how the packs stand; only the operator window imports, stops, removes or reads a licence', async () => {
    const h = harness('/placeholder/pack');
    expect(await h.ask(true, IPC.modelPacks.view)).toEqual(NONE);
    for (const [channel, args] of [
      [IPC.modelPacks.remove, ['placeholder-pack']],
      [IPC.modelPacks.licence, ['placeholder-pack', 'licences/MIT.txt']],
    ] as const)
      expect(await h.ask(false, channel, ...args)).toEqual({ ok: false, message: NOT_THE_OPERATOR });
    expect(await h.ask(false, IPC.modelPacks.import, 'folder')).toEqual({
      ok: false,
      message: NOT_THE_OPERATOR,
      status: NONE,
    });
    expect(await h.ask(false, IPC.modelPacks.cancel)).toBe(false);
    expect(h.pick).not.toHaveBeenCalled();
  });

  it('chooses the pack in main’s own dialog, as a folder or a zip: nothing chosen, nothing done', async () => {
    const h = harness(null);
    expect(await h.ask(true, IPC.modelPacks.import, 'zip')).toEqual({
      ok: false,
      message: NOTHING_CHOSEN,
      cancelled: true,
      status: NONE,
    });
    expect(h.pick).toHaveBeenCalledWith('zip');
    expect(await h.ask(true, IPC.modelPacks.import, '/a/path/from/the/page')).toEqual({
      ok: false,
      message: NOT_THE_OPERATOR,
      status: NONE,
    });
    expect(h.pick).toHaveBeenCalledTimes(1);
    expect(await h.ask(true, IPC.modelPacks.remove, 42)).toEqual({ ok: false, message: NOT_THE_OPERATOR });
    expect(await h.ask(true, IPC.modelPacks.remove, 'placeholder-pack')).toEqual({
      ok: false,
      message: 'That pack is no longer on this computer.',
    });
    expect(await h.ask(true, IPC.modelPacks.cancel)).toBe(true);
  });

  it('are all Pro Mode’s: Simple Mode refuses each in its own shape', () => {
    const ours = [
      IPC.modelPacks.view,
      IPC.modelPacks.import,
      IPC.modelPacks.cancel,
      IPC.modelPacks.remove,
      IPC.modelPacks.licence,
    ];
    expect(SIMPLE_MODE_LOCKED).toEqual(expect.arrayContaining(ours));
    const answers = simpleModeRefusals(() => ({}) as never);
    expect(answers.get(IPC.modelPacks.cancel)?.()).toBe(false);
    expect(answers.get(IPC.modelPacks.import)?.()).toMatchObject({ ok: false });
  });
});
