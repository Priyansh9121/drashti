import type { DrashtiBridge } from '../shared/bridge';

/*
 * Which of the bridge's groups each window's page gets (Sessions 31–36, ARCH-7): only those its own code
 * uses. src/main/release-checks/page-groups.test.ts walks each page's code from its entry and checks this
 * table against what it uses, both ways. The main process still checks every request as before: this is
 * defence in depth, so a page that something got into reaches no more than its own.
 */

export type BridgeGroup = keyof DrashtiBridge;
export type BridgePage =
  | 'index'
  | 'output'
  | 'audio'
  | 'stream'
  | 'node'
  | 'pdf'
  | 'pdf-export'
  | 'sharpen'
  | 'gallery'
  | 'zoom'
  | 'lock'
  | 'access-list'
  | 'lower-thirds'
  | 'slide-editor';

export const PAGE_GROUPS: Record<BridgePage, readonly BridgeGroup[]> = {
  // The operator window: everything but the node's window, the PDF window and the sharpening window.
  index: [
    // The stop and the countdown (Session 54), over either mode.
    'access',
    'announcements',
    'app',
    'appearance',
    'audio',
    'backups',
    'calendar',
    'captions',
    'drop',
    'engine',
    'events',
    'files',
    'guides',
    'kirtans',
    'library',
    'links',
    'liveWindow',
    'lowerThirds',
    'media',
    'messages',
    'midi',
    'music',
    'network',
    'nodes',
    // The opening as Drashti starts, and File › Opening… (Session 55).
    'opening',
    'output',
    'pip',
    'playlists',
    // Ready? and the quick bar (Session 55, Part 8).
    'quickBar',
    'ready',
    'screens',
    // Audience and Stage (Session 50).
    'screenSwitches',
    'setup',
    'shastra',
    // The slide editor's window (Session 55, Part 17a): opened from here, its saves come back here for Undo.
    'slideEditor',
    // Audio's Music steps aside, a file's Even loudness, Trim black and silence (Session 55, Part 7).
    'sound',
    'stageLayouts',
    'stream',
    'timers',
    'updates',
    'videoInputs',
    // The wallpapers (Session 55, Part 6).
    'wallpapers',
    'zoom',
  ],
  // The hall's screens (a video input up now, Session 50: whether this computer has it, and how it stands).
  output: ['app', 'engine', 'liveWindow', 'media', 'output', 'videoInputs'],
  // The audio player.
  audio: ['audio', 'engine', 'media'],
  // The stream's picture.
  stream: ['app', 'engine', 'liveWindow', 'media', 'output', 'stream', 'videoInputs'],
  // A node's own window.
  node: ['app', 'guides', 'node'],
  // A deck's PDF made into pictures.
  pdf: ['pictures'],
  'pdf-export': ['engine', 'media', 'output', 'pdfExport'],
  // Pictures' sharpened copies.
  sharpen: ['sharpen'],
  // The component gallery (Diagnostics).
  gallery: ['app', 'guides'],
  // The window for Zoom (Session 48): the stream's picture only.
  zoom: ['app', 'zoom'],
  // The lock screen (Session 54), before this computer is let in: nothing of the show.
  lock: ['access', 'app'],
  // The Access List (Session 54, E4): the owner's window onto the access list.
  'access-list': ['accessList', 'app'],
  // The Lower Thirds studio (Session 55, Part 16): the lower thirds, and what is up (the engine's state, read only).
  'lower-thirds': ['app', 'engine', 'lowerThirds'],
  // The slide editor's window (Session 55, Part 17a): a presentation's slides read and saved, the library's pictures,
  // videos and sounds to put on them (and their looks), the screens (their safe areas), video inputs, timers, and what
  // is up; a picture's file arriving again (output, as every page drawing slides). The video inputs' store reaches the
  // operator's actions (playlists, screenSwitches): the main process refuses their changes from here.
  'slide-editor': [
    'app',
    'engine',
    'library',
    'media',
    'output',
    'playlists',
    'screenSwitches',
    'screens',
    'slideEditor',
    'timers',
    'videoInputs',
  ],
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
