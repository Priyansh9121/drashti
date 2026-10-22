import { pipPlaceSchema } from '../../shared/engine/commands';
import type { EngineState, PipPlace } from '../../shared/engine/state';
import { DEFAULT_PIP_PLACE, type PipSettingsResult } from '../../shared/pip';
import { sameData } from '../engine/reducer';

/*
 * Picture in picture's remembered place (Session 50): where a new box goes and how it looks (its corner or
 * where it was dragged, its size, border, rounded corners and motion), kept in the library's settings for next
 * time. The operator saves it (IPC.pip.savePlace, Pro Mode); and as the operator moves or resizes the box up
 * (placePip), it is remembered by itself, so the next box starts where this one was left.
 */

/** The setting it is kept under (app_meta "setting.pip.place"). */
export const PIP_PLACE_SETTING = 'pip.place';

export interface PipPlacesDeps {
  /** The library's settings (db/settings.ts). */
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  /**
   * How what the show remembers by itself reaches the library: when it is free, never waiting for an import
   * (index.ts laterSetting). Left out: at once.
   */
  write?: (name: string, value: unknown) => void;
}

export class PipPlaces {
  /** The place as the library has it (read once). */
  private remembered: PipPlace | null = null;
  /** The box's place last seen on the screens. */
  private seen: PipPlace | null = null;

  constructor(private readonly deps: PipPlacesDeps) {}

  /** Where a new box goes, as the library remembers; bottom right, Medium (DEFAULT_PIP_PLACE) until then. */
  place(): PipPlace {
    if (this.remembered === null) {
      const kept = pipPlaceSchema.safeParse(this.deps.settings.get(PIP_PLACE_SETTING));
      this.remembered = kept.success ? kept.data : DEFAULT_PIP_PLACE;
    }
    return this.remembered;
  }

  /** The operator saves where a new box goes and how it looks (checked; a wrong one changes nothing). */
  save(raw: unknown): PipSettingsResult {
    const parsed = pipPlaceSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message: 'Choose a corner or a place on the screen, Small, Medium or Large, and how it comes on.',
      };
    this.remembered = parsed.data;
    this.deps.settings.set(PIP_PLACE_SETTING, parsed.data);
    return { ok: true, place: parsed.data };
  }

  /** The show changed: the box up, moved or resized, is remembered where it is now (once each time). */
  follow(state: EngineState): void {
    const place = state.layers.pip?.place ?? null;
    if (place === null || place === this.seen) return;
    this.seen = place;
    if (sameData(place, this.place())) return;
    this.remembered = place;
    if (this.deps.write) this.deps.write(PIP_PLACE_SETTING, place);
    else this.deps.settings.set(PIP_PLACE_SETTING, place);
  }
}
