import type { PlayOrder, PlayedSlide } from '../engine/slide-source';
import type { PresentationDoc, SlideCue, SlideInfo } from '../../shared/library';
import type {
  PassageInfo,
  PassageKey,
  PassageResult,
  ShastraHit,
  ShastraTextInfo,
  ShastraTree,
} from '../../shared/shastra';
import { parsePassageId, passageId, referenceLine, resolveReference } from '../../shared/shastra';
import type { FitTargets, PassageSlide } from '../../shared/shastra-slides';
import { passageSlides } from '../../shared/shastra-slides';
import type { ThemeFields } from '../../shared/themes';
import type { ShastraRepo } from '../db/shastra';

/*
 * The Shastra module in the main process (Session 12). A passage plays like
 * a presentation: its id (shared/shastra.ts) stands where a presentation's
 * would, and this service gives the engine its play order and the operator
 * window's slide grid its document, made from the text with the text's
 * theme, cut to fit where the live Look shows it (shared/shastra-slides.ts).
 * A passage is made again when its text is loaded again, its theme changes
 * or the live Look does; otherwise the same slides (and objects) come back.
 */

export interface ShastraServiceDeps {
  repo: ShastraRepo;
  /** A text's theme (or Drashti's default when it has none, or it was removed). */
  theme(themeId: string | null): ThemeFields;
  /** Where passages must fit, from the live Look. */
  targets(): FitTargets;
  /** A background picture or video's name and state, for the slide grid. */
  media?(mediaId: string): { name: string; missing: boolean; unplayable: string | null } | null;
}

interface Built {
  stamp: string;
  display: string;
  key: PassageKey;
  textId: string;
  items: { id: string; number: number; reference: string }[];
  slides: PassageSlide[];
  cues: SlideCue[];
}

/** How many passages stay made (the live one, what comes next, what the operator looked at). */
const KEEP = 24;

export class ShastraService {
  private readonly made = new Map<string, Built>();

  constructor(private readonly deps: ShastraServiceDeps) {}

  /** A passage's slides; null when its id names nothing loaded. */
  private build(id: string): Built | null {
    const key = parsePassageId(id);
    if (!key) return null;
    const content = this.deps.repo.passage(key);
    if (!content) return null;
    const theme = this.deps.theme(content.text.themeId);
    const targets = this.deps.targets();
    const stamp = JSON.stringify([content.text.loadedAt, content.text.themeId, theme, targets]);
    const earlier = this.made.get(id);
    if (earlier?.stamp === stamp) return earlier;
    const items = content.items.map((it) => ({
      id: it.id,
      number: it.number,
      reference: referenceLine(content.text.name, content.sectionLabels, it.number, it.number),
      texts: it.texts,
    }));
    const slides = passageSlides(items, theme, id, targets);
    const bg = theme.background;
    const media = bg.kind === 'media' ? this.deps.media?.(bg.mediaId) : null;
    const cues: SlideCue[] =
      bg.kind === 'media'
        ? [
            {
              kind: 'background',
              label: '',
              name: media?.name ?? '',
              missing: media?.missing ?? false,
              unplayable: media?.unplayable ?? null,
              background: { kind: 'media', mediaId: bg.mediaId, media: bg.media, fit: bg.fit, loop: bg.loop },
            },
          ]
        : [];
    const built: Built = {
      stamp,
      display: referenceLine(content.text.name, content.sectionLabels, key.from, key.to),
      key,
      textId: content.text.id,
      items: items.map(({ id: itemId, number, reference }) => ({ id: itemId, number, reference })),
      slides,
      cues,
    };
    this.made.delete(id);
    this.made.set(id, built);
    while (this.made.size > KEEP) {
      const oldest = this.made.keys().next().value;
      if (oldest === undefined) break;
      this.made.delete(oldest);
    }
    return built;
  }

  /** The engine's play order for a passage (SlideSource), or null. */
  order(id: string): PlayOrder | null {
    const b = this.build(id);
    if (!b) return null;
    const slides: PlayedSlide[] = b.slides.map((s) => ({
      id: s.slide.id,
      slide: s.slide,
      // A media background of the theme goes on the background layer, as a presentation's does.
      cues: b.cues,
      notes: '',
    }));
    return { arrangementId: null, slides, transition: null, loop: false };
  }

  /** A passage as the slide grid shows it: a group of slides for each item. */
  doc(id: string): PresentationDoc | null {
    const b = this.build(id);
    if (!b) return null;
    let index = 0;
    const groups = b.items.map((item, i) => ({
      id: `${id}@${i + 1}`,
      name: item.reference,
      color: null,
      slides: b.slides
        .filter((s) => s.item === i)
        .map((s): SlideInfo => ({
          id: s.slide.id,
          index: index++,
          label: s.of > 1 ? `${s.part} of ${s.of}` : '',
          notes: '',
          slide: s.slide,
          cues: b.cues,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
        })),
    }));
    return {
      id,
      name: b.display,
      width: 1920,
      height: 1080,
      groups,
      arrangements: [],
      selectedArrangementId: null,
      transition: null,
      loop: false,
      kirtan: null,
      source: null,
      passage: { textId: b.textId, reference: b.display, key: b.key },
    };
  }

  /** What a reference names, ready to show; or why it names nothing. */
  resolve(reference: string): PassageResult {
    const r = resolveReference(reference, this.deps.repo.refTexts());
    if (!r.ok) return r;
    const id = passageId(r.key);
    if (!this.build(id)) return { ok: false, message: `${r.display} has no words loaded.` };
    return { ok: true, passage: { passageId: id, key: r.key, reference: r.display } };
  }

  /** A passage by its id, as the operator window shows it before it goes up. */
  info(id: string): PassageInfo | null {
    const b = this.build(id);
    return b ? { passageId: id, key: b.key, reference: b.display } : null;
  }

  /** One item, by its id in the browser, as a passage. */
  itemPassage(itemId: string): PassageInfo | null {
    const key = this.deps.repo.itemKey(itemId);
    return key ? this.info(passageId(key)) : null;
  }

  search(query: string): ShastraHit[] {
    return this.deps.repo.search(query);
  }

  list(): ShastraTextInfo[] {
    return this.deps.repo.list();
  }

  tree(textId: string): ShastraTree | null {
    return this.deps.repo.tree(textId);
  }

  setTheme(textId: string, themeId: string | null): boolean {
    return this.deps.repo.setTheme(textId, themeId);
  }

  remove(textId: string): boolean {
    return this.deps.repo.remove(textId);
  }
}
