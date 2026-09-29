import type { SlideCue } from '../../shared/library';
import type { RenderSlide } from '../../shared/model';

/** Where the engine looks up slides. Backed by SQLite in the app, by memory in tests. */
export interface SlideSource {
  /** Number of slides in the presentation (in its current order), or null if it does not exist. */
  slideCount(presentationId: string): number | null;
  /** The slide at `index`, or null when the presentation or index does not exist. */
  slide(presentationId: string, index: number): RenderSlide | null;
  /** What the slide at `index` does on the other layers when it goes live. */
  cues(presentationId: string, index: number): readonly SlideCue[];
}

/** A SlideSource over an in-memory map. */
export class MemorySlideSource implements SlideSource {
  private readonly slideCues = new Map<string, SlideCue[][]>();

  constructor(private readonly presentations: Map<string, RenderSlide[]> = new Map()) {}

  /** `cues[i]` are slide i's cues. */
  set(presentationId: string, slides: RenderSlide[], cues: SlideCue[][] = []): void {
    this.presentations.set(presentationId, slides);
    this.slideCues.set(presentationId, cues);
  }

  delete(presentationId: string): void {
    this.presentations.delete(presentationId);
    this.slideCues.delete(presentationId);
  }

  slideCount(presentationId: string): number | null {
    return this.presentations.get(presentationId)?.length ?? null;
  }

  slide(presentationId: string, index: number): RenderSlide | null {
    return this.presentations.get(presentationId)?.[index] ?? null;
  }

  cues(presentationId: string, index: number): readonly SlideCue[] {
    return this.slideCues.get(presentationId)?.[index] ?? [];
  }
}
