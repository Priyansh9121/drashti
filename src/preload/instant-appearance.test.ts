import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc';
import type { AppearanceNow } from '../shared/appearance/appearances';

const listeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    on: (channel: string, handler: (...args: unknown[]) => void) => listeners.set(channel, handler),
    sendSync: () => null,
  },
  webUtils: {},
}));

afterEach(() => { vi.unstubAllGlobals(); listeners.clear(); });

describe('the actual own-window preload appearance listener', () => {
  it('draws dark/light palettes in the IPC call and cancels CSS transitions before paint, without capture', async () => {
    vi.resetModules();
    const props = new Map<string, string>();
    const palette = { transitionProperty: 'color', cancel: vi.fn() };
    const help = { cancel: vi.fn() };
    const getAnimations = vi.fn(() => {
      expect(props.get('--color-header')).toBe('#e6e8ea');
      return [palette, help];
    });
    const startViewTransition = vi.fn(() => { throw new Error('Document capture is forbidden'); });
    const root = {
      dataset: { opened: '', chip: 'yes', interfaceMotion: 'calm' } as Record<string, string>,
      style: {
        setProperty: (key: string, value: string) => { props.set(key, value); },
        getPropertyValue: (key: string) => props.get(key) ?? '',
        getPropertyPriority: () => '',
        removeProperty: (key: string) => { props.delete(key); },
      },
    };
    vi.stubGlobal('location', { href: 'http://localhost/index.html' });
    vi.stubGlobal('document', Object.assign(new EventTarget(), {
      documentElement: root, visibilityState: 'visible', querySelectorAll: () => [], getAnimations, startViewTransition,
    }));
    await import('./index');
    const next: AppearanceNow = {
      id: 'white', base: 'light', vars: { '--color-header': '#e6e8ea' }, motion: 'calm', chip: 'yes',
      moving: false, look: [], slow: false, depth: false,
    };
    const changed = listeners.get(IPC.appearance.changed);
    expect(changed).toBeTypeOf('function');
    changed?.({}, next);
    expect(root.dataset['appearance']).toBe('white');
    expect(getAnimations).toHaveBeenCalledTimes(1);
    expect(palette.cancel).toHaveBeenCalledTimes(1);
    expect(help.cancel).not.toHaveBeenCalled();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
