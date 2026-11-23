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
  | 'display-copy'
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
    // Caption words (alpha.22, cap-glossary): File › Live Captions… › Caption Words…, Pro Mode.
    'captionWords',
    'videoCaptions',
    'drop',
    'engine',
    'events',
    'files',
    'guides',
    'kirtans',
    'library',
    'links',
    // Show a Stream Link… (alpha.20, slice 8), and a link up drawn in LIVE.
    'liveLink',
    'liveWindow',
    'lowerThirds',
    // The Drashti Manual (x37, Session 60).
    'manual',
    // Help › Report a Problem… (x49).
    'report',
    'media',
    'messages',
    'midi',
    // Help › Caption and Translation Models… (alpha.22, cap-pack).
    'modelPacks',
    'music',
    'network',
    'nodes',
    // The opening as Drashti starts, and File › Opening… (Session 55).
    'opening',
    'osc',
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
    // Scheduling on YouTube (x31): Stream settings and the Stream panel.
    'youtube',
    'zoom',
  ],
  // The hall's screens (a video input up now, Session 50: whether this computer has it, and how it stands).
  // A stream link up (alpha.20): each screen joins it (render/live-playback.ts).
  output: ['app', 'engine', 'liveLink', 'liveWindow', 'media', 'output', 'videoInputs'],
  // The audio player (a stream link's sound joins as its pictures do, alpha.20).
  audio: ['audio', 'engine', 'liveLink', 'media'],
  // The stream's picture.
  stream: ['app', 'engine', 'liveLink', 'liveWindow', 'media', 'output', 'stream', 'videoInputs'],
  // A node's own window, including its explicitly enabled shared show view. Main-only changes have no node handlers.
  // Its code reaches the panels' "What is this?" (ui/Panel's SectionTitle beside it), whose Open the manual asks the
  // manual (x37; the guides until then), though no panel of its own has a "?".
  node: [
    'app',
    'engine',
    'liveLink',
    'liveWindow',
    'manual',
    'media',
    'node',
    'output',
    'report',
    'videoInputs',
  ],
  // A deck's PDF made into pictures.
  pdf: ['pictures'],
  'pdf-export': ['engine', 'media', 'output', 'pdfExport'],
  // Pictures' sharpened copies.
  sharpen: ['sharpen'],
  // Pictures' display copies (alpha.22): a hidden worker of their own, with its own page (QA22-L8-2).
  'display-copy': ['displayCopies'],
  // The component gallery (Diagnostics).
  // Its panels' "What is this?" asks the manual (x37; the guides until then).
  gallery: ['app', 'manual'],
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
    'files',
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
