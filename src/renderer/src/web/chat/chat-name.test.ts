import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChatName from './chat-name';

/** A browser's storage for this address, as a phone keeps it (or one that refuses, as private browsing can). */
function storage(refuses = false): Storage {
  const kept = new Map<string, string>();
  return {
    get length() {
      return kept.size;
    },
    clear: () => kept.clear(),
    key: (i: number) => [...kept.keys()][i] ?? null,
    getItem: (k: string) => {
      if (refuses) throw new Error('SecurityError');
      return kept.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (refuses) throw new Error('QuotaExceededError');
      kept.set(k, v);
    },
    removeItem: (k: string) => {
      kept.delete(k);
    },
  };
}

let names: typeof ChatName;

beforeEach(async () => {
  vi.resetModules();
  names = await import('./chat-name');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the name a phone keeps for the chat', () => {
  it('is none until the person gives it', () => {
    vi.stubGlobal('localStorage', storage());
    expect(names.keptChatName()).toBeNull();
  });

  it('is remembered on the phone, tidied, after it is given once', async () => {
    const kept = storage();
    vi.stubGlobal('localStorage', kept);
    names.keepChatName('  Placeholder\tVolunteer ');
    expect(names.keptChatName()).toBe('Placeholder Volunteer');
    // The page opened again later (a new load of the module): still known.
    vi.resetModules();
    const again = await import('./chat-name');
    expect(again.keptChatName()).toBe('Placeholder Volunteer');
    expect(kept.getItem('drashti.chat.name')).toBe('Placeholder Volunteer');
  });

  it('is never taken from storage when it is not a name the chat accepts (edited by hand)', () => {
    const kept = storage();
    kept.setItem('drashti.chat.name', 'x'.repeat(400));
    vi.stubGlobal('localStorage', kept);
    expect(names.keptChatName()).toBeNull();
  });

  it('still works for this page where the browser keeps nothing', () => {
    vi.stubGlobal('localStorage', storage(true));
    expect(names.keptChatName()).toBeNull();
    names.keepChatName('Placeholder Volunteer');
    expect(names.keptChatName()).toBe('Placeholder Volunteer');
  });
});
