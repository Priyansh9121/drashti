import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_MAX,
  CHAT_INVITE_TTL_MS,
  CHAT_LINES_MAX,
  CHAT_PEOPLE_MAX,
  CHAT_RATE,
  CHAT_TEXT_MAX,
} from '../shared/chat';
import { type Block, type Inline, imagesOf, inlineText, parseMarkdown } from '../shared/markdown';
import { SIMPLE_FEATURES } from '../shared/simple-features';

/*
 * The chat's words (alpha.23, QA23-CHAT-1): the operator's, the admin's and the phone's guides and the Drashti Manual
 * tell the chat as it is built. Each has a passage of its own; every name they show in bold is one the window or the
 * phone's page shows, as it shows it; the limits are Main's own; the phone guide gives the page's microphone hint word
 * for word; the admin's says who is in it, what is kept and what never is; and the pictures are ones already shipped
 * (none retaken for the chat). Read from the real files, never a fixture.
 */

const app = process.cwd();
const docs = join(app, 'docs');
const blocksOf = (file: string): Block[] => parseMarkdown(readFileSync(join(docs, file), 'utf8'));

/** The paragraphs that start with these words in bold ("**Chat.** In **Chat**…"). */
const led = (blocks: readonly Block[], words: string): Block[] =>
  blocks.filter(
    (b) =>
      b.kind === 'paragraph' &&
      b.children[0]?.kind === 'strong' &&
      inlineText(b.children[0].children) === words,
  );

/** Those paragraphs, each with the list right under it (its points). */
const ledWithList = (blocks: readonly Block[], words: string): Block[] =>
  led(blocks, words).flatMap((p) => {
    const next = blocks[blocks.indexOf(p) + 1];
    return next?.kind === 'list' ? [p, next] : [p];
  });

/** A level-2 section's blocks: from its heading up to the next heading of level 2 or above. */
function section(blocks: readonly Block[], title: string): Block[] {
  const start = blocks.findIndex(
    (b) => b.kind === 'heading' && b.level === 2 && inlineText(b.children) === title,
  );
  if (start < 0) return [];
  const from = blocks.slice(start);
  const end = from.findIndex((b, i) => i > 0 && b.kind === 'heading' && b.level <= 2);
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
 * Every bold span's words in some blocks, in order. `leads: false` leaves out the bold words a paragraph or a point
 * starts with ("**The first time**, type…"): the guide's own words, not a name on a screen.
 */
function bold(blocks: readonly Block[], { leads = true }: { leads?: boolean } = {}): string[] {
  const out: string[] = [];
  const inline = (list: readonly Inline[], top: boolean) => {
    list.forEach((n, i) => {
      if (n.kind !== 'strong') return;
      if (leads || !top || i > 0) out.push(inlineText(n.children));
      inline(n.children, false);
    });
  };
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.kind === 'heading' || b.kind === 'paragraph') inline(b.children, b.kind === 'paragraph');
      else if (b.kind === 'list') for (const item of b.items) walk(item.blocks);
    }
  };
  walk(blocks);
  return out;
}

/** The chat's passage in each guide and the Manual. */
const passages = () => ({
  operator: led(blocksOf('operator-guide.md'), 'Chat.'),
  admin: ledWithList(blocksOf('admin-guide.md'), 'The chat'),
  phone: section(blocksOf('presenter-guide.md'), 'The chat'),
  manual: section(blocksOf('manual/phones.md'), 'The chat'),
});

/** A source file's words, or nothing while it is not there (so a missing part fails by what it lacks). */
const sourceText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

function sourcesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesIn(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

/** What the chat's own parts show: the operator's section and Chat QR, the phone's page and tab, Main's words. */
const chatSources = () =>
  [
    ...sourcesIn(join(app, 'src', 'renderer', 'src', 'chat')),
    ...sourcesIn(join(app, 'src', 'renderer', 'src', 'web', 'chat')),
    join(app, 'src', 'renderer', 'src', 'web', 'remote', 'RemoteApp.tsx'),
    join(app, 'src', 'shared', 'chat.ts'),
    join(app, 'src', 'shared', 'simple-features.ts'),
  ]
    .map(sourceText)
    .join('\n');

/**
 * Names the chat's passages show in bold that are the rest of Drashti's, each with where it is: they stay true
 * whatever the chat's parts say. Anything else a chat passage shows in bold must be in the chat's own parts.
 */
const OTHER_NAMES: Record<string, string> = {
  Phones: 'the header’s button that opens the Phones panel',
  LIVE: 'the operator window’s column the sections sit under',
  Messages: 'the section the Chat section comes after',
  Remove: 'the Phones panel’s own button beside a paired device',
  'Let paired phones and tablets connect': 'the Phones panel’s switch',
  'Simple Mode Features…': 'the Edit menu’s item',
  Edit: 'the menu',
  'Pair a Remote device': 'the Phones panel’s pairing button',
  'Pair an Announcements device': 'the Phones panel’s pairing button',
};

describe('the chat’s words (alpha.23, QA23-CHAT-1)', () => {
  it('each guide and the Manual tell the chat in a passage of their own', () => {
    const found = passages();
    expect(found.operator, 'the operator’s guide: a paragraph led by **Chat.**').toHaveLength(1);
    expect(led(found.admin, 'The chat'), 'the admin’s guide: a paragraph led by **The chat**').toHaveLength(
      1,
    );
    expect(found.phone.length, 'the phone guide: ## The chat').toBeGreaterThan(1);
    expect(found.manual.length, 'the Manual’s Phones and network: ## The chat').toBeGreaterThan(1);
  });

  it('names in bold only what the window and the phone’s page show, as they show it', () => {
    const shown = chatSources();
    const found = passages();
    const names = [...new Set(Object.values(found).flatMap((blocks) => bold(blocks, { leads: false })))];
    expect(names.length).toBeGreaterThan(5);
    const unknown = names.filter((n) => !shown.includes(n) && !(n in OTHER_NAMES));
    expect(unknown).toEqual([]);
  });

  it('gives Main’s own limits, as Main refuses past them', () => {
    const { operator, admin, phone } = passages();
    const adminText = textOf(admin);
    for (const words of [
      `${String(CHAT_TEXT_MAX)} characters`,
      `${String(CHAT_LINES_MAX)} lines`,
      `${String(CHAT_PEOPLE_MAX)} people`,
      `last ${String(CHAT_HISTORY_MAX)} messages`,
      `${String(CHAT_INVITE_TTL_MS / 60_000)} minutes`,
      `every ${String(1 / CHAT_RATE.perSecond)} seconds`,
    ])
      expect(adminText, words).toContain(words);
    expect(textOf(operator)).toContain(`${String(CHAT_TEXT_MAX)} characters`);
    expect(textOf(phone)).toContain(`${String(CHAT_TEXT_MAX)} characters`);
  });

  it('the phone guide gives the page’s microphone hint word for word', () => {
    const page = sourceText(join(app, 'src', 'renderer', 'src', 'web', 'chat', 'ChatView.tsx'));
    const hint = /export const MIC_HINT = '([^']+)'/u.exec(page)?.[1] ?? null;
    expect(hint, 'the page’s MIC_HINT').not.toBeNull();
    expect(bold(passages().phone)).toContain(hint);
  });

  it('the admin’s guide says who is in the chat, where it goes, what is kept and what never is', () => {
    const text = textOf(passages().admin);
    const facts: [RegExp, string][] = [
      [/Wi-Fi/u, 'it goes over the mandir’s Wi-Fi'],
      [/no internet|never (?:over |to )?the internet/u, 'and never the internet'],
      [/\bRemote\b/u, 'a phone remote is in it'],
      [/\bAnnouncements\b/u, 'an Announcements device is in it'],
      [/Chat QR code/u, 'more people join by the Chat QR code'],
      [/Stage device/u, 'a stage tablet never is'],
      [/poster/u, 'nor the poster’s link'],
      [/for (?:the day|today) only/u, 'it is kept for the day only'],
      [/Clear chat/u, 'the operator empties it'],
      [/never written to a log/u, 'its words and names are never logged'],
      [/Remove…/u, 'the operator removes a person'],
      [
        /iPhone[^.]*(?:no vibration|never (?:buzzes|vibrates))|no vibration[^.]*iPhone/u,
        'an iPhone has no vibration',
      ],
      [
        /keyboard[^.]*(?:voice typing|microphone)|(?:voice typing|microphone)[^.]*keyboard/u,
        'the keyboard’s voice typing',
      ],
    ];
    expect(facts.filter(([fact]) => !fact.test(text)).map(([, why]) => why)).toEqual([]);
  });

  it('the guides’ lists of Pro Mode’s tools in Simple Mode name Simple Mode Features’ own, in its order', () => {
    const names = SIMPLE_FEATURES.map((f) => f.name);
    for (const file of ['operator-guide.md', 'admin-guide.md']) {
      const paragraph = led(blocksOf(file), "Pro Mode's tools in Simple Mode");
      expect(paragraph, `${file}: **Pro Mode's tools in Simple Mode**`).toHaveLength(1);
      const listed = [...new Set(bold(paragraph).filter((n) => names.includes(n)))];
      expect(listed, file).toEqual(names);
    }
    const manual = section(blocksOf('manual/simple.md'), "Pro Mode's tools in Simple Mode");
    expect([...new Set(bold(manual).filter((n) => names.includes(n)))], 'manual/simple.md').toEqual(names);
  });

  it('shows only pictures already shipped: none is retaken for the chat', () => {
    const shipped = new Set(readdirSync(join(docs, 'screenshots')));
    const { operator, admin, phone, manual } = passages();
    const pictures = [...imagesOf([...operator, ...admin, ...phone]), ...imagesOf(manual)].map((src) =>
      src.replace(/^(?:\.\.\/)?screenshots\//u, ''),
    );
    expect(pictures.filter((name) => !shipped.has(name))).toEqual([]);
  });
});
