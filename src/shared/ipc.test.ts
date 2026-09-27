import { describe, expect, it } from 'vitest';
import { allChannels } from './ipc';

describe('IPC channels', () => {
  it('are unique and namespaced', () => {
    const channels = allChannels();
    expect(new Set(channels).size).toBe(channels.length);
    for (const c of channels) expect(c).toMatch(/^[a-z]+:[a-z-]+$/);
  });
});
