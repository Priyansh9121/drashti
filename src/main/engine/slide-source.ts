import type { SlideCue } from '../../shared/library';
import type { RenderSlide } from '../../shared/model';

/** One slide as the engine plays it. */
export interface PlayedSlide {
  /** The slide's id: the same slide comes up more than once when an arrangement repeats its group. */
  id: string;
  slide: RenderSlide;
  cues: readonly SlideCue[];
  notes: string;
}

/** A presentation's slides in playing order (PLAN.md 4.3, arrangements). */
export interface PlayOrder {
  /** The arrangement they follow, or null for every slide in order. */
  arrangementId: string | null;
  slides: readonly PlayedSlide[];
}

/** Where the engine looks up slides. Backed by SQLite in the app, by memory in tests. */
export interface SlideSource {
  /**
   * A presentation's slides in playing order, or null if it does not exist:
   * its selected order when `arrangementId` is left out, every slide in
   * order for null, or that arrangement's order (every slide, if the
   * presentation has no such arrangement).
   */
  order(presentationId: string, arrangementId?: string | null): PlayOrder | null;
}

interface MemoryEntry {
  slides: PlayedSlide[];
  /** Arrangements as lists of slide indexes (tests do not need groups). */
  arrangements: Map<string, number[]>;
  selected: string | null;
}

/** A SlideSource over an in-memory map. */
export class MemorySlideSource implements SlideSource {
  private readonly entries = new Map<string, MemoryEntry>();

  /** `cues[i]` and `notes[i]` belong to slide i; an arrangement lists slide indexes. */
  set(
    presentationId: string,
    slides: RenderSlide[],
    cues: SlideCue[][] = [],
    options: { arrangements?: Record<string, number[]>; selected?: string | null; notes?: string[] } = {},
  ): void {
    this.entries.set(presentationId, {
      slides: slides.map((slide, i) => ({
        id: slide.id,
        slide,
        cues: cues[i] ?? [],
        notes: options.notes?.[i] ?? '',
      })),
      arrangements: new Map(Object.entries(options.arrangements ?? {})),
      selected: options.selected ?? null,
    });
  }

  delete(presentationId: string): void {
    this.entries.delete(presentationId);
  }

  order(presentationId: string, arrangementId?: string | null): PlayOrder | null {
    const entry = this.entries.get(presentationId);
    if (!entry) return null;
    const wanted = arrangementId === undefined ? entry.selected : arrangementId;
    const indexes = wanted === null ? undefined : entry.arrangements.get(wanted);
    const slides = indexes?.flatMap((i) => (entry.slides[i] ? [entry.slides[i]] : [])) ?? [];
    return slides.length > 0 && wanted !== null
      ? { arrangementId: wanted, slides }
      : { arrangementId: null, slides: entry.slides };
  }
}
