import type { DrashtiBridge } from '../shared/bridge';

/*
 * Which of the bridge's groups each window's page gets (Sessions 31–36, ARCH-7): only those its own code
 * uses. src/main/release-checks/page-groups.test.ts walks each page's code from its entry and checks this
 * table against what it uses, both ways. The main process still checks every request as before: this is
 * defence in depth, so a page that something got into reaches no more than its own.
 */

export type BridgeGroup = keyof DrashtiBridge;
export type BridgePage = 'index' | 'output' | 'audio' | 'stream' | 'node' | 'pdf' | 'sharpen' | 'gallery';

export const PAGE_GROUPS: Record<BridgePage, readonly BridgeGroup[]> = {
  // The operator window: everything but the node's window, the PDF window and the sharpening window.
  index: [
    'announcements',
    'app',
    'appearance',
    'audio',
    'backups',
    'calendar',
    'drop',
    'engine',
    'events',
    'files',
    'guides',
    'idle',
    'kirtans',
    'library',
    'links',
    'liveWindow',
    'looks',
    'lowerThirds',
    'masks',
    'media',
    'messages',
    'midi',
    'music',
    'network',
    'nodes',
    'output',
    'playlists',
    'props',
    'roles',
    'screens',
    'setup',
    'shastra',
    'stageLayouts',
    'stream',
    'themes',
    'timers',
    'updates',
  ],
  // The hall's screens.
  output: ['app', 'engine', 'liveWindow', 'media', 'output'],
  // The audio player.
  audio: ['audio', 'engine', 'media'],
  // The stream's picture.
  stream: ['app', 'engine', 'liveWindow', 'media', 'output', 'stream'],
  // A node's own window.
  node: ['app', 'guides', 'node'],
  // A deck's PDF made into pictures.
  pdf: ['pictures'],
  // Pictures' sharpened copies.
  sharpen: ['sharpen'],
  // The component gallery (Diagnostics).
  gallery: ['app', 'guides'],
};

/** The page a window shows, from its address (its file's name; Vite's root is the operator's), or null. */
export function pageOf(href: string): BridgePage | null {
  let name: string;
  try {
    name = new URL(href).pathname.split('/').pop() ?? '';
  } catch {
    return null;
  }
  const page = name === '' ? 'index' : name.replace(/\.html$/u, '');
  return Object.hasOwn(PAGE_GROUPS, page) ? (page as BridgePage) : null;
}

/** The page's own groups of the bridge: nothing for a page that is not one of Drashti's. */
export function bridgeFor<T extends object>(bridge: T, page: BridgePage | null): Partial<T> {
  if (page === null) return {};
  const groups = new Set<string>(PAGE_GROUPS[page]);
  return Object.fromEntries(Object.entries(bridge).filter(([group]) => groups.has(group))) as Partial<T>;
}
