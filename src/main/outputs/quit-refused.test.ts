import { describe, expect, it, vi } from 'vitest';
import { onQuitRefused } from './quit-refused';

describe('quit refusal', () => {
  it('observes a later listener preventing before-quit or window close', async () => {
    const event = { defaultPrevented: false };
    const resume = vi.fn();
    onQuitRefused(event, resume);
    expect(resume).not.toHaveBeenCalled();
    event.defaultPrevented = true;
    await Promise.resolve();
    expect(resume).toHaveBeenCalledOnce();
  });

  it('leaves an accepted quit guarded', async () => {
    const resume = vi.fn();
    onQuitRefused({ defaultPrevented: false }, resume);
    await Promise.resolve();
    expect(resume).not.toHaveBeenCalled();
  });

  it('handles beforeunload refusal, including the Electron override allowing unload', async () => {
    const refused = vi.fn();
    const allowed = vi.fn();
    onQuitRefused({ defaultPrevented: false }, refused, true);
    const override = { defaultPrevented: false };
    onQuitRefused(override, allowed, true);
    override.defaultPrevented = true;
    await Promise.resolve();
    expect(refused).toHaveBeenCalledOnce();
    expect(allowed).not.toHaveBeenCalled();
  });
});
