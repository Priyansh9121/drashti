import type { PptxDeck } from '../pictures';
import type { PptxMedia } from './pptx-deck';

/*
 * Keynote's own PowerPoint copy of a deck (bake.ts keynoteOnMac), its sounds across slides as the deck plays them
 * (Session 54). Tried on the dev Mac with placeholder decks:
 *
 * - A .key's soundtrack (Document › Audio › Soundtrack: Play Once or Loop) is in its copy as a sound on the first
 *   slide playing across 999 slides, looping when Loop: so it plays across the whole deck here too. But its copy
 *   always says 50%, whatever the soundtrack's own volume (100% and 25% both came out so), and writes it even when
 *   the soundtrack is Off. Keynote's scripting tells neither, and the .key's own parts are Apple's undocumented
 *   format, which changes between Keynote's versions: so its volume is Keynote's own default, full, and an Off one
 *   is told by Keynote's movie of the deck, which then has no sound (its slides' own movies and sounds are taken out
 *   before the movie is made, and Keynote has no transition sounds). A soundtrack on a first slide skipped in
 *   Keynote plays from the first slide shown, as Keynote plays it from the show's start.
 * - A .pptx Keynote opened: a sound across slides on its first slide becomes Keynote's soundtrack (across 999, at
 *   50%), and one on a later slide plays on that slide only. The .pptx itself says what PowerPoint plays, so its
 *   sounds take how many slides they play across, their volume, loop and fades from it, slide by slide where the
 *   sounds of the two match one for one; Keynote's copy keeps when each starts (its steps are Keynote's).
 */

const isSound = (m: PptxMedia) => m.kind === 'audio';
const isSoundtrack = (m: PptxMedia) => isSound(m) && m.acrossSlides !== null;

/** A sound of Keynote's copy as the .pptx itself has it (its start stays Keynote's). */
function asOriginal(copy: PptxMedia, original: PptxMedia): PptxMedia {
  return {
    ...copy,
    name: original.name || copy.name,
    acrossSlides: original.acrossSlides,
    volume: original.volume,
    muted: original.muted,
    loop: original.loop,
    fadeInMs: original.fadeInMs,
    fadeOutMs: original.fadeOutMs,
  };
}

/**
 * Keynote's copy with its sounds across slides as the deck plays them. `original` is the .pptx Keynote opened (null for
 * a .key); `movieSound` whether Keynote's movie of the deck had sound (null before it is made).
 */
export function keynoteMusic(
  copy: PptxDeck,
  from: { original: PptxDeck | null; movieSound: boolean | null },
): PptxDeck {
  const { original } = from;
  const matched = original !== null && original.slides.length === copy.slides.length;
  const slides = copy.slides.map((slide, i) => {
    const d = slide.deck;
    if (!d) return slide;
    const theirs = matched ? (original.slides[i]?.deck?.media.filter(isSound) ?? []) : null;
    const ours = d.media.filter(isSound);
    // A .pptx's own, slide by slide, where its sounds and Keynote's match one for one.
    if (theirs?.length === ours.length) {
      const media = d.media.map((m) => {
        const k = ours.indexOf(m);
        const own = k >= 0 ? theirs[k] : undefined;
        return own ? asOriginal(m, own) : m;
      });
      return { ...slide, deck: { ...d, media } };
    }
    // Keynote's soundtrack: at full volume; left out when Keynote's movie had no sound (it is Off).
    const media = d.media.flatMap((m): PptxMedia[] =>
      !isSoundtrack(m) ? [m] : from.movieSound === false ? [] : [{ ...m, volume: 1 }],
    );
    return { ...slide, deck: { ...d, media } };
  });
  // A soundtrack on a first slide skipped in Keynote: with the first slide shown instead (from its start, never at a
  // click: group -1 is before its first).
  const first = slides[0];
  const shown = slides.findIndex((s) => !s.hidden);
  const track = first?.hidden ? first.deck?.media.filter(isSoundtrack) : undefined;
  const to = shown > 0 ? slides[shown] : undefined;
  if (first?.deck && track && track.length > 0 && to?.deck) {
    slides[0] = {
      ...first,
      deck: { ...first.deck, media: first.deck.media.filter((m) => !isSoundtrack(m)) },
    };
    slides[shown] = {
      ...to,
      deck: {
        ...to.deck,
        media: [...to.deck.media, ...track.map((m) => ({ ...m, start: { group: -1, offsetMs: 0 } }))],
      },
    };
  }
  return { ...copy, slides };
}
