import { nativeDeckMotion, type DeckSlide } from './deck';
import { deckStep } from './deck-show';

/*
 * A deck's slide the operator points at, loaded ahead (C3, Session 58: Q57-26). A click on a deck slide's row is a
 * jump: its first clip starts past the deck's own transition (main/engine/deck-steps.ts deckShow). Loaded only as the
 * click came, that clip held the slide going away for 0.14-0.37 s on CI's computers (worst 0.27-0.74 s) while it
 * loaded and decoded. So while the operator's pointer rests on a slide's row (or presses it, or the keyboard is on
 * it), every screen that loads what comes next ahead (the outputs' Preloader) loads that slide's first clip too,
 * paused at the very frame the click starts it from, and the slide's step plays that element at the click. One such
 * clip at a time on a page (beside Next's): the next row pointed at takes its place, and it is let go of when the
 * pointer leaves the list, or when this computer is short of memory.
 */

/** How long the pointer rests on a row before its slide is said (ms): one passing over rows on its way says nothing. */
export const REST_MS = 60;
/** How long after the pointer leaves the list (or the keyboard a row) its slide is let go of (ms). */
export const LINGER_MS = 1000;

/** A slide of the show, as a click on its row puts it up (the engine's goLive). */
export interface PointAt {
  presentationId: string;
  slideIndex: number;
  /** The order it is played in (an arrangement), null for every slide in order. */
  arrangementId: string | null;
}

/** A deck slide's first clip, as a click on the slide's row plays it: the file and where it starts. */
export interface PointedClip {
  /** The clip's media id. */
  mediaId: string;
  /** How far into the clip a jump starts it (ms): past the deck's own transition, as deckShow's jump has it. */
  fromMs: number;
}

/**
 * The first clip a click on this deck's slide plays, and from where; null when there is none to load: no deck, a deck
 * Drashti plays itself (its effects drawn from its shapes, no clip), one still being prepared (its clips being
 * made), a first step with no motion, or one a jump shows at its last frame (its whole clip its own transition).
 */
export function pointedClip(deck: DeckSlide | undefined): PointedClip | null {
  if (!deck || deck.preparing || nativeDeckMotion(deck)) return null;
  const step = deckStep(deck, 0);
  if (!step || step.clipMs <= 0 || !step.clipId) return null;
  const fromMs = Math.max(0, step.transitionMs ?? 0);
  // Shown still (deck-show.ts stepClock): from its end, there is nothing to play.
  if (fromMs >= step.clipMs) return null;
  return { mediaId: step.clipId, fromMs };
}

/** The same clip from the same point (or both none). */
export function sameClip(a: PointedClip | null, b: PointedClip | null): boolean {
  return a === b || (a !== null && b !== null && a.mediaId === b.mediaId && a.fromMs === b.fromMs);
}

/** This computer's memory, as Electron's process.getSystemMemoryInfo() gives it (KB). */
export interface SystemMemory {
  total: number;
  free: number;
  /** Linux: what the kernel can give without swapping. */
  available?: number;
  /** macOS: the file cache's pages (given back as soon as something needs them). */
  fileBacked?: number;
  /** macOS: memory marked purgeable. */
  purgeable?: number;
}

/**
 * The least memory this computer must have to spare for anything to be loaded ahead for a pointer (KB): 400 MB, or a
 * twentieth of it all where that is more. A clip loaded ahead costs a screen's page about what Next's does (a few
 * megabytes of file and a decoded frame); below this, nothing is loaded ahead, and what was is let go of, so the show's
 * own pictures never wait for memory because of it.
 */
export function leastToSpareKb(totalKb: number): number {
  return Math.max(400 * 1024, totalKb / 20);
}

/**
 * The memory this computer could give a page now (KB): on Windows what Electron calls free (its available memory,
 * standby pages included), on Linux what the kernel says is available, on a Mac the free pages and those it gives back
 * at once (the file cache and what is purgeable); a Mac keeps little memory free at all.
 */
export function spareKb(memory: SystemMemory, platform: string): number {
  if (platform === 'linux' && typeof memory.available === 'number') return memory.available;
  if (platform === 'darwin') return memory.free + (memory.fileBacked ?? 0) + (memory.purgeable ?? 0);
  return memory.free;
}

/** Whether there is memory to spare to load a pointed slide's clip ahead. */
export function roomToLoadAhead(memory: SystemMemory, platform: string): boolean {
  return spareKb(memory, platform) >= leastToSpareKb(memory.total);
}
