import type { RenderSlide } from '../../shared/model';

/** Where the engine looks up slides. Backed by SQLite in the app, by memory in tests. */
export interface SlideSource {
  /** Number of slides in the presentation (in its current order), or null if it does not exist. */
  slideCount(presentationId: string): number | null;
  /** The slide at `index`, or null when the presentation or index does not exist. */
  slide(presentationId: string, index: number): RenderSlide | null;
}

/** A SlideSource over an in-memory map. */
export class MemorySlideSource implements SlideSource {
  constructor(private readonly presentations: Map<string, RenderSlide[]> = new Map()) {}

  set(presentationId: string, slides: RenderSlide[]): void {
    this.presentations.set(presentationId, slides);
  }

  delete(presentationId: string): void {
    this.presentations.delete(presentationId);
  }

  slideCount(presentationId: string): number | null {
    return this.presentations.get(presentationId)?.length ?? null;
  }

  slide(presentationId: string, index: number): RenderSlide | null {
    return this.presentations.get(presentationId)?.[index] ?? null;
  }
}
