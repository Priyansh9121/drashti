import { basename } from 'node:path';
import { mediaUrl } from '../../shared/media';
import {
  cleanLine,
  type OpeningChoice,
  openingChoiceSchema,
  type OpeningEnd,
  type OpeningPlan,
  openingPhotoUrl,
  type OpeningResult,
  type OpeningSetting,
  type OpeningView,
  readOpening,
} from '../../shared/opening';
import { plural } from '../../shared/text';
import { readPack, saveOpeningCopy } from './opening-files';
import { openingAtStart } from './opening-start';

/*
 * The opening in the main process (Session 55, the owner's brief of 3 Nov 2026; shared/opening.ts says what it is):
 * kept with the library's settings ("opening", no migration), decided once as the operator window opens
 * (opening-start.ts), and changed only from File › Opening… in Pro Mode. The log says whether it played and why
 * not, never its words or its photos.
 */

/** A picture in the library the opening can show: its file's sha256 and its name. */
export interface OpeningPicture {
  sha256: string;
  name: string;
}

export interface OpeningServiceDeps {
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  /** A write that never holds up the start (the version that started, below). */
  later(name: string, value: unknown): void;
  /** What this start is, known once Drashti has started. */
  boot: { selfTest: boolean; testNotAsking: boolean; cleanQuit: boolean; restored: boolean; version: string };
  /** A picture the opening can show (in the library, not deleted, its file there), or null. */
  picture(mediaId: string): OpeningPicture | null;
  /** Whether a photo's copy for the opening is made. */
  hasCopy(sha256: string): boolean;
  mediaDir: string;
  /** The first start's welcome, or Simple Mode's first steps, show now. */
  welcome(): boolean;
  /** Bring files into Media (an import's run): each one's media id, in order, or why not. */
  importPhotos(paths: string[]): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }>;
  log(line: string): void;
}

export class OpeningService {
  /** The version that last started with this library, read before this start says its own. */
  private readonly lastVersion: string | null;
  private asked = false;

  constructor(private readonly deps: OpeningServiceDeps) {
    const last = deps.settings.get('lastStartVersion');
    this.lastVersion = typeof last === 'string' ? last : null;
    if (this.lastVersion !== deps.boot.version) deps.later('lastStartVersion', deps.boot.version);
  }

  private kept(): OpeningSetting {
    return readOpening(this.deps.settings.get('opening'));
  }

  /**
   * As the operator window opens: what it plays, or null. Asked once at a start; `pageAgain` when its page was
   * loaded again (or its process ended) since, `sinceWindow` how long after the window was made (ms).
   */
  atStart(window: { pageAgain: boolean; sinceWindow: number }): OpeningPlan | null {
    const kept = this.kept();
    const decided = openingAtStart({
      node: false,
      ...this.deps.boot,
      lastVersion: this.lastVersion,
      welcome: this.deps.welcome(),
      on: kept.on,
      pageAgain: window.pageAgain,
      asked: this.asked,
      sinceWindow: window.sinceWindow,
    });
    // Only the first ask is said: a page loaded again asks again and is simply told no.
    const first = !this.asked;
    this.asked = true;
    if (!decided.play) {
      if (first) this.deps.log(`Opening: not played (${decided.why})`);
      return null;
    }
    const photos = kept.photos.flatMap((id) => {
      const picture = this.deps.picture(id);
      if (!picture) return [];
      // Its copy at the window's size (backups carry the copies); a photo whose copy is not made yet (File › Opening…
      // closed while it was being made, say) shows its whole file this time, and File › Opening… makes the copy.
      return [this.deps.hasCopy(picture.sha256) ? openingPhotoUrl(id) : mediaUrl(id)];
    });
    const without = kept.photos.length - photos.length;
    this.deps.log(
      `Opening: plays (${photos.length === 0 ? 'the lamp' : plural(photos.length, 'photo')}, ${plural(kept.lines.length, 'line')}${
        without > 0 ? `; ${plural(without, 'photo')} no longer in Media left out` : ''
      })`,
    );
    return { photos, lines: kept.lines };
  }

  /** It ended. */
  ended(how: OpeningEnd, afterMs: number): void {
    this.deps.log(
      `Opening: ended ${how === 'itself' ? 'by itself' : `by a ${how}`} after ${String(Math.round(afterMs))} ms`,
    );
  }

  view(): OpeningView {
    const kept = this.kept();
    return {
      on: kept.on,
      photos: kept.photos.map((mediaId) => {
        const picture = this.deps.picture(mediaId);
        return {
          mediaId,
          name: picture?.name ?? '',
          ready: picture !== null && this.deps.hasCopy(picture.sha256),
          gone: picture === null,
        };
      }),
      lines: kept.lines,
    };
  }

  setOn(on: boolean): OpeningResult {
    this.deps.settings.set('opening', { ...this.kept(), on });
    this.deps.log(`Opening: turned ${on ? 'on' : 'off'}`);
    return { ok: true, view: this.view() };
  }

  /** The photos and lines chosen in File › Opening…, checked whole. */
  setChoice(raw: unknown): OpeningResult {
    const choice = openingChoiceSchema.safeParse(raw);
    if (!choice.success) return { ok: false, message: 'That choice of photos and lines cannot be kept.' };
    if (choice.data.photos.some((id) => this.deps.picture(id) === null))
      return { ok: false, message: 'Only a picture in Media can be one of the opening’s photos.' };
    this.keep(choice.data);
    return { ok: true, view: this.view() };
  }

  private keep(choice: OpeningChoice): void {
    const lines = choice.lines.map(cleanLine).filter((line) => line !== '');
    this.deps.settings.set('opening', { on: this.kept().on, photos: choice.photos, lines });
  }

  /**
   * Load the opening pack…: the folder's photos brought into Media, and they and its lines made the opening's only
   * ones, in order, replacing any chosen before. A pack missing a photo or a line says what, and nothing changes.
   */
  async loadPack(dir: string): Promise<OpeningResult> {
    const pack = await readPack(dir);
    if (!pack.ok) {
      this.deps.log('Opening: a pack that was not complete was not loaded');
      return pack;
    }
    const imported = await this.deps.importPhotos(pack.photos);
    if (!imported.ok) return imported;
    const notPictures = imported.ids.flatMap((id, i) =>
      this.deps.picture(id) ? [] : [basename(pack.photos[i] ?? '')],
    );
    if (notPictures.length > 0)
      return {
        ok: false,
        message: `In the opening pack, ${notPictures.join(', ')} did not come into Media as ${notPictures.length === 1 ? 'a picture' : 'pictures'}. Nothing was changed.`,
      };
    this.keep({ photos: imported.ids, lines: pack.lines });
    this.deps.log(
      `Opening: the opening pack's ${plural(imported.ids.length, 'photo')} and ${plural(pack.lines.length, 'line')} are the opening's now`,
    );
    return { ok: true, view: this.view() };
  }

  /** A photo's copy for the opening, from the operator window. */
  async saveCopy(mediaId: string, bytes: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    const picture = typeof mediaId === 'string' ? this.deps.picture(mediaId) : null;
    if (!picture) return { ok: false, message: 'That photo is not in Media.' };
    return saveOpeningCopy(this.deps.mediaDir, picture.sha256, bytes);
  }
}
