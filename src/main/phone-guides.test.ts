import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Block, inlineText, parseMarkdown } from '../shared/markdown';
import { DEVICE_KIND_HELP } from '../shared/network';
import { PANEL_HELP } from '../shared/panel-help';
import { PHONE_REFUSAL, REMOTE_PHONE_COMMANDS, REMOTE_PHONE_OPS } from '../shared/phone-rule';

/*
 * The phone rule's words (alpha.23, QA23-PHONE-1; the owner: "no video access in either of simple or pro mode in
 * phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple mode only show the flow, whats
 * running in live, and chat", then "Only PPT and PDF"). The phone's guide, the operator's and the admin's guides, the
 * Manual, the API's guide and the set-up day tell the rule as Main enforces it (shared/phone-rule.ts): what a phone
 * shows and does in each mode, the refusals word for word, nothing the rule takes away still offered, Companion and
 * the Stream Deck on OSC, and phones no longer sending or seeing files (the owner's Q11, "Words now, hide later").
 * Read from the real files, never a fixture.
 */

const app = process.cwd();
const docs = join(app, 'docs');
const read = (file: string): string => readFileSync(join(docs, file), 'utf8');
const blocksOf = (file: string): Block[] => parseMarkdown(read(file));

/** The paragraphs that start with these words in bold. */
const led = (blocks: readonly Block[], words: string): Block[] =>
  blocks.filter(
    (b) =>
      b.kind === 'paragraph' &&
      b.children[0]?.kind === 'strong' &&
      inlineText(b.children[0].children) === words,
  );

/** A section's blocks: from its heading (of this level) up to the next heading of that level or above. */
function section(blocks: readonly Block[], title: string, level = 2): Block[] {
  const start = blocks.findIndex(
    (b) => b.kind === 'heading' && b.level === level && inlineText(b.children) === title,
  );
  if (start < 0) return [];
  const from = blocks.slice(start);
  const end = from.findIndex((b, i) => i > 0 && b.kind === 'heading' && b.level <= level);
  return end < 0 ? from : from.slice(0, end);
}

/** Every word some blocks show, in order (headings, paragraphs, lists' items, tables). */
function textOf(blocks: readonly Block[]): string {
  const out: string[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.kind === 'heading' || b.kind === 'paragraph') out.push(inlineText(b.children));
      else if (b.kind === 'list') for (const item of b.items) walk(item.blocks);
      else if (b.kind === 'table') for (const row of b.rows) out.push(row.cells.map(inlineText).join(' '));
    }
  };
  walk(blocks);
  return out.join('\n');
}

/**
 * What a phone's page offered before alpha.23 that the rule takes away from every phone, by the names the page
 * showed: the files, the sharing, the zoom on the screens, the playlists' changes, the music, the time bar's skips,
 * the quick bar and the Drashti computer's set-up. A passage about the phone never offers one again.
 */
const GONE = [
  'Add from this Phone',
  'Add photos',
  'Shared from Drashti',
  'Show this zoom on the screens',
  'Back to Whole',
  'Picture editor',
  'Manage playlists',
  'Start going round',
  'Play music',
  'Back 15 s',
  'Forward 15 s',
  'quick bar',
  'The Drashti computer',
  'Change the library',
  'Save picture',
];

const offered = (text: string): string[] => GONE.filter((name) => text.includes(name));

/** The phone's own passages: the phone's guide, and the phone's parts of the other guides and the Manual. */
const phonePassages = () => ({
  presenter: read('presenter-guide.md'),
  operatorRemote: textOf(led(blocksOf('operator-guide.md'), 'The phone remote.')),
  operatorSimple: textOf(led(blocksOf('operator-guide.md'), 'The phone in Simple Mode.')),
  adminRule: textOf(led(blocksOf('admin-guide.md'), 'The phone rule (alpha.23).')),
  manualRemote: textOf(section(blocksOf('manual/phones.md'), 'The phone remote')),
  manualSimple: textOf(section(blocksOf('manual/simple.md'), 'A phone in Simple Mode')),
});

/** What a Remote may still ask in both modes, by the request's route as the API's guide writes it. */
const BOTH: Record<string, string> = {
  me: 'GET /api/v1/me',
  status: 'GET /api/v1/status',
  state: 'GET /api/v1/state',
  hall: 'GET /api/v1/hall',
  preview: 'GET /api/v1/media/{id}/preview',
  'media.picture': 'GET /api/v1/media/{id}/picture',
  chat: 'GET /api/v1/chat',
  'chat.name': 'POST /api/v1/chat/name',
  'chat.send': 'POST /api/v1/chat/messages',
  flow: 'GET /api/v1/flow',
  'flow.page': 'GET /api/v1/flow/pages/{id}',
};

/** What a Remote may also ask in Pro Mode ('command' is the deck commands, below). */
const PRO: Record<string, string> = {
  playlists: 'GET /api/v1/playlists',
  items: 'GET /api/v1/playlists/{id}/items',
  presentation: 'GET /api/v1/presentations/{id}',
};

/** The commands a Pro Mode phone may send, for a PowerPoint or a PDF only, by their routes. */
const DECK: Record<string, string> = {
  goLive: 'POST /api/v1/trigger/slide',
  playItem: 'POST /api/v1/trigger/item',
  next: 'POST /api/v1/trigger/next',
  previous: 'POST /api/v1/trigger/previous',
  back: 'POST /api/v1/trigger/back',
  clearLayer: 'POST /api/v1/clear/slide',
};

/** The API guide's sections whose requests a Remote is refused, all or some: each says so in a line of its own. */
const API_SECTIONS = [
  'Reading',
  'Running the show (Remote)',
  'Files: shared playlists and adding from a phone (Remote)',
  "The computer's screens, video inputs and windows (Remote)",
  'Companion (Stream Deck)',
];

/**
 * Lines that name Companion or a Stream Deck without OSC, each with why: they stay true whatever a Remote's token
 * may do. Every other such line in the guides, the Manual and the API's guide names OSC.
 */
const COMPANION_KEPT: { file: string; words: string; why: string }[] = [
  {
    file: 'api.md',
    words: 'a script or Companion cannot use it',
    why: 'the node link, which no script or Companion ever used',
  },
];

describe('the phone rule’s words (alpha.23, QA23-PHONE-1)', () => {
  it('the rule is the one the words tell: what both modes allow, what Pro Mode adds, and the deck commands', () => {
    const where = (want: 'both' | 'pro') =>
      Object.entries(REMOTE_PHONE_OPS)
        .filter(([, allowed]) => allowed === want)
        .map(([op]) => op)
        .sort();
    expect(where('both')).toEqual(Object.keys(BOTH).sort());
    expect(where('pro')).toEqual([...Object.keys(PRO), 'command'].sort());
    expect(
      Object.entries(REMOTE_PHONE_COMMANDS)
        .filter(([, allowed]) => allowed === 'deck')
        .map(([type]) => type)
        .sort(),
    ).toEqual(Object.keys(DECK).sort());
  });

  it('the phone’s guide gives every refusal word for word, both modes, and the PowerPoint, the PDF and Keynote', () => {
    const guide = read('presenter-guide.md');
    expect(Object.values(PHONE_REFUSAL).filter((words) => !guide.includes(words))).toEqual([]);
    for (const words of ['Simple Mode', 'Pro Mode', 'PowerPoint', 'PDF', 'Keynote', 'Sabha flow', 'Chat'])
      expect(guide, words).toContain(words);
  });

  it('no passage about the phone offers what the rule takes away', () => {
    const found = Object.entries(phonePassages()).flatMap(([where, text]) =>
      offered(text).map((name) => `${where}: ${name}`),
    );
    expect(found).toEqual([]);
  });

  it('every passage about the phone is there, and tells both modes: Simple Mode the flow, LIVE and the chat; Pro Mode a PowerPoint or a PDF', () => {
    const passages = phonePassages();
    for (const [where, text] of Object.entries(passages)) expect(text.length, where).toBeGreaterThan(100);
    for (const where of ['operatorRemote', 'adminRule', 'manualRemote'] as const)
      for (const words of ['PowerPoint', 'PDF', 'Pro Mode', 'Simple Mode'])
        expect(passages[where], `${where}: ${words}`).toContain(words);
    for (const where of ['operatorSimple', 'manualSimple'] as const)
      for (const words of ['Sabha flow', 'what is on the screens', 'chat'])
        expect(passages[where].toLowerCase(), `${where}: ${words}`).toContain(words.toLowerCase());
  });

  it('the API’s guide names every request a Remote may still make, by its route, and quotes every refusal', () => {
    const api = blocksOf('api.md');
    const rule = textOf(section(api, 'The phone rule (alpha.23)'));
    expect(rule.length, 'api.md: ## The phone rule (alpha.23)').toBeGreaterThan(100);
    const routes = [...Object.values(BOTH), ...Object.values(PRO), ...Object.values(DECK)];
    expect(routes.filter((route) => !rule.includes(route))).toEqual([]);
    expect(Object.values(PHONE_REFUSAL).filter((words) => !rule.includes(words))).toEqual([]);
    for (const words of ['Simple Mode', 'Pro Mode', 'Companion', 'Stream Deck', 'OSC', '403'])
      expect(rule, words).toContain(words);
  });

  it('each of the API guide’s sections with requests a Remote is refused says so in a line of its own', () => {
    const api = blocksOf('api.md');
    const missing = API_SECTIONS.filter(
      (title) => led(section(api, title), 'The phone rule (alpha.23).').length === 0,
    );
    expect(missing).toEqual([]);
  });

  it('sends Companion and the Stream Deck to OSC wherever a guide, the Manual or the API’s guide names them', () => {
    const files = [
      'operator-guide.md',
      'admin-guide.md',
      'presenter-guide.md',
      'setup-day.md',
      'parallel-run.md',
      'api.md',
      ...[
        'audio',
        'editor',
        'help',
        'keys',
        'library',
        'live',
        'messages',
        'phones',
        'playlists',
        'screens',
        'settings',
        'sharing',
        'simple',
        'stage',
        'start',
        'stream',
        'tools',
      ].map((c) => `manual/${c}.md`),
    ];
    const found = files.flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, i) =>
          /Companion|Stream Deck/u.test(line) &&
          !/\bOSC\b/u.test(line) &&
          !COMPANION_KEPT.some((k) => k.file === file && line.includes(k.words))
            ? [`${file}:${String(i + 1)}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
    // Each one kept is still there (else it goes from the list).
    for (const k of COMPANION_KEPT) expect(read(k.file), k.why).toContain(k.words);
    // The old way, a Remote's token over Companion's Generic HTTP, is never offered again.
    expect(read('api.md')).not.toContain('**Generic HTTP** connection drives Drashti');
  });

  it('the operator window says phones no longer send or receive files, where its controls stay for now (Q11)', () => {
    const section = readFileSync(join(app, 'src', 'renderer', 'src', 'network', 'AddFilesSection.tsx'), 'utf8');
    const share = readFileSync(join(app, 'src', 'renderer', 'src', 'playlists', 'share-with-phones.tsx'), 'utf8');
    expect(section).toContain('Phones no longer send files to Drashti');
    expect(section).not.toContain('Add from this Phone');
    expect(share).toContain('Phones no longer see shared playlists');
    expect(PANEL_HELP.phones.text).toContain('Phones no longer send or receive files');
    expect(`${PANEL_HELP.phones.text} ${PANEL_HELP.playlists.text}`).not.toMatch(
      /Add from this Phone|Add photos|Shared from Drashti/u,
    );
    for (const file of ['manual/phones.md', 'operator-guide.md', 'admin-guide.md'])
      expect(read(file), file).toContain('Phones no longer send or receive files');
  });

  it('pairing a Remote says what it does in both modes, true to the rule', () => {
    const help = DEVICE_KIND_HELP.remote;
    for (const words of ['Sabha flow', 'what is on the screens', 'chat', 'Pro Mode', 'PowerPoint', 'PDF'])
      expect(help, words).toContain(words);
    // A deck's own videos play as made (QA23-PHONE-2, as built), and the screens' pictures show: never "no pictures".
    expect(help).not.toMatch(/never videos, pictures or sounds/u);
  });
});
