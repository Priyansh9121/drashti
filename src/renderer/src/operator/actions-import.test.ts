import { afterEach, describe, expect, it, vi } from 'vitest';

/* Stores such as Undo and video inputs use the operator actions without mounting the window's view. */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the operator actions used by stores', () => {
  it('loads with the bridge window and no document, without initializing a dialog or its motion', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { drashti: { engine: { dispatch: vi.fn() } } });
    vi.stubGlobal('document', undefined);
    const actions = await import('./actions');
    expect(actions.runSimpleAction).toBeTypeOf('function');
    expect(actions.undoSimple).toBeTypeOf('function');
  });
});
