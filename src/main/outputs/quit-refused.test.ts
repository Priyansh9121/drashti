import { describe, expect, it, vi } from 'vitest';
import { onQuitRefused, resumeAfterRefusal, type QuitResume } from './quit-refused';

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

  it('keeps the guard during an owned asynchronous hold decided by a later listener', async () => {
    const event = { defaultPrevented: false };
    const resume = vi.fn();
    let held = false;
    onQuitRefused(event, resume, false, () => held);
    event.defaultPrevented = true;
    held = true;
    await Promise.resolve();
    expect(resume).not.toHaveBeenCalled();
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

describe('after a refused quit (review S3)', () => {
  const main = (library: boolean, operator: boolean) => {
    const did: string[] = [];
    const to: QuitResume = {
      libraryOpen: () => library,
      reset: () => did.push('reset'),
      screens: () => did.push('screens'),
      operatorOpen: () => operator,
      openOperator: () => did.push('operator window'),
    };
    return { to, did };
  };

  it('a refused source stop after the operator window closed (its X began the quit) opens it again, with the screens', () => {
    const { to, did } = main(true, false);
    resumeAfterRefusal(to, true);
    expect(did).toEqual(['reset', 'screens', 'operator window']);
  });

  it('with the operator window still open, only the screens come back', () => {
    const { to, did } = main(true, true);
    resumeAfterRefusal(to, true);
    expect(did).toEqual(['reset', 'screens']);
  });

  it('any other refusal leaves the operator window as it is, as before', () => {
    const { to, did } = main(true, false);
    resumeAfterRefusal(to, false);
    expect(did).toEqual(['reset', 'screens']);
  });

  it('once the library has closed, nothing comes back', () => {
    const { to, did } = main(false, false);
    resumeAfterRefusal(to, true);
    expect(did).toEqual([]);
  });
});
