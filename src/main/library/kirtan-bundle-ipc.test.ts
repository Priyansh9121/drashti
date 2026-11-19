import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerKirtanBundleIpc } from './kirtan-bundle-ipc';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(name, handler);
  },
}));
beforeEach(() => handlers.clear());

function setup(operator = true) {
  let allowed = true;
  const pickOutput = vi.fn(() => Promise.resolve('/placeholder/Chosen.drashti-kirtans' as string | null));
  const run = vi.fn(() =>
    Promise.resolve({ ok: true as const, file: '/placeholder/Chosen.drashti-kirtans', kirtans: 1, media: 0 }),
  );
  registerKirtanBundleIpc({
    fromOperator: () => operator,
    canExport: () => allowed,
    pickOutput,
    exporter: { export: run },
  });
  const call = (input: unknown) => handlers.get('kirtans:export-bundle')?.({}, input);
  return {
    pickOutput,
    run,
    call,
    revoke: () => {
      allowed = false;
    },
  };
}

describe('kirtan bundle export IPC', () => {
  const request = { presentationIds: ['placeholder'], includeMedia: false };
  it('uses a native chosen path and only accepts a valid operator request', async () => {
    const t = setup();
    expect(await t.call(request)).toMatchObject({ ok: true });
    expect(t.run).toHaveBeenCalledWith({ ...request, output: '/placeholder/Chosen.drashti-kirtans' });
    const other = setup(false);
    expect(await other.call(request)).toMatchObject({ ok: false });
    expect(other.pickOutput).not.toHaveBeenCalled();
  });
  it('rejects empty choices, over-limit choices, arbitrary paths and non-boolean media flags before opening a dialog', async () => {
    const t = setup();
    for (const input of [
      { ...request, presentationIds: [] },
      { ...request, presentationIds: Array.from({ length: 1001 }, () => 'placeholder') },
      { ...request, output: '/unexpected/path' },
      { ...request, includeMedia: 'yes' },
    ])
      expect(await t.call(input)).toMatchObject({ ok: false });
    expect(t.pickOutput).not.toHaveBeenCalled();
    expect(t.run).not.toHaveBeenCalled();
  });
  it('cancels without writing and rechecks Pro Mode after the native save dialog closes', async () => {
    const t = setup();
    t.pickOutput.mockResolvedValueOnce(null);
    expect(await t.call(request)).toMatchObject({ ok: false, cancelled: true });
    t.pickOutput.mockImplementationOnce(() => {
      t.revoke();
      return Promise.resolve('/placeholder/Chosen.drashti-kirtans');
    });
    expect(await t.call(request)).toMatchObject({ ok: false });
    expect(t.run).not.toHaveBeenCalled();
  });
});
