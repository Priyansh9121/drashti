import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { mediaUrl } from '../../shared/media';
import {
  openingChoiceSchema,
  type OpeningEnd,
  type OpeningPlan,
  openingPhotoUrl,
  openingPlanOf,
  type OpeningResult,
  type OpeningSetting,
  type OpeningSound,
  openingSoundUrl,
  type OpeningView,
  readOpening,
} from '../../shared/opening';
import { dropSoundCopy, keepSoundCopy, openingSoundPath, readPack, saveOpeningCopy } from './opening-files';
import { openingAtStart } from './opening-start';

/*
 * The opening in the main process (Session 55, the owner's brief of 3 Nov 2026; alpha.16, his words of 11 Nov 2026:
 * shared/opening.ts says what it is): kept with the library's settings ("opening", no migration: alpha.15's several
 * photos and lines read as its first photo), decided once as the operator window opens (opening-start.ts), and changed
 * only from File › Opening… in Pro Mode. With no photo chosen, Drashti's default photo (opening-photo.ts; the lamp
 * should its file be missing), never with a sound. The log says whether it played and why not, never the name of its
 * photo or its sound.
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
  boot: {
    selfTest: boolean;
    testNotAsking: boolean;
    cleanQuit: boolean;
    recentStop: boolean;
    restored: boolean;
    version: string;
  };
  /** A picture the opening can show (in the library, not deleted, its file there), or null. */
  picture(mediaId: string): OpeningPicture | null;
  /** Whether a photo's copy for the opening is made. */
  hasCopy(sha256: string): boolean;
  /** Whether Drashti's default photo is there (opening-photo.ts). */
  defaultPhoto(): boolean;
  /** The media folder: the opening's copies are kept in its opening/. */
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

  private keep(setting: OpeningSetting): void {
    this.deps.settings.set('opening', setting);
  }

  /** Whether the copy of a kept sound is in the media folder. */
  private soundThere(sound: OpeningSound | null): sound is OpeningSound {
    return sound !== null && existsSync(join(this.deps.mediaDir, openingSoundPath(sound)));
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
    const picture = kept.photo === null ? null : this.deps.picture(kept.photo);
    // Its copy at the window's size (backups carry the copies); a photo whose copy is not made yet (File › Opening…
    // closed while it was being made, say) shows its whole file this time, and File › Opening… makes the copy.
    const photo =
      kept.photo === null || picture === null
        ? null
        : this.deps.hasCopy(picture.sha256)
          ? openingPhotoUrl(kept.photo)
          : mediaUrl(kept.photo);
    const sound = photo !== null && this.soundThere(kept.sound) ? openingSoundUrl(kept.sound.sha256) : null;
    const plan = openingPlanOf(photo, sound, photo === null && this.deps.defaultPhoto());
    const gone = kept.photo !== null && picture === null ? '; its photo is no longer in Media' : '';
    this.deps.log(
      plan.defaultPhoto
        ? `Opening: plays (the default photo${gone})`
        : plan.photo === null
          ? `Opening: plays (the lamp${gone}; the default photo’s file is missing)`
          : `Opening: plays (its photo${
              plan.sound ? ' and sound' : kept.sound ? '; its sound’s copy is missing' : ''
            })`,
    );
    return plan;
  }

  /** It ended. */
  ended(how: OpeningEnd, afterMs: number): void {
    this.deps.log(
      `Opening: ended ${how === 'itself' ? 'by itself' : `by a ${how}`} after ${String(Math.round(afterMs))} ms`,
    );
  }

  view(): OpeningView {
    const kept = this.kept();
    const picture = kept.photo === null ? null : this.deps.picture(kept.photo);
    return {
      on: kept.on,
      photo:
        kept.photo === null
          ? null
          : {
              mediaId: kept.photo,
              name: picture?.name ?? '',
              ready: picture !== null && this.deps.hasCopy(picture.sha256),
              gone: picture === null,
            },
      sound: this.soundThere(kept.sound)
        ? { name: kept.sound.name, url: openingSoundUrl(kept.sound.sha256) }
        : null,
      defaultPhoto: this.deps.defaultPhoto(),
    };
  }

  setOn(on: boolean): OpeningResult {
    this.keep({ ...this.kept(), on });
    this.deps.log(`Opening: turned ${on ? 'on' : 'off'}`);
    return { ok: true, view: this.view() };
  }

  /** The photo chosen in File › Opening… (null: Drashti's default photo), checked whole; the sound stays. */
  setChoice(raw: unknown): OpeningResult {
    const choice = openingChoiceSchema.safeParse(raw);
    if (!choice.success) return { ok: false, message: 'That photo cannot be the opening’s.' };
    const { photo } = choice.data;
    if (photo !== null && this.deps.picture(photo) === null)
      return { ok: false, message: 'Only a picture in Media can be the opening’s photo.' };
    this.keep({ ...this.kept(), photo });
    return { ok: true, view: this.view() };
  }

  /** The pack's sound taken out: none plays, and its copy goes. */
  async removeSound(): Promise<OpeningResult> {
    const kept = this.kept();
    this.keep({ ...kept, sound: null });
    if (kept.sound) await dropSoundCopy(this.deps.mediaDir, kept.sound);
    this.deps.log('Opening: its sound was taken out');
    return { ok: true, view: this.view() };
  }

  /** The kept sound's copy with this sha256, relative to the media folder (for drashti-media://), or null. */
  soundFile(sha256: string): string | null {
    const { sound } = this.kept();
    return sound !== null && sound.sha256 === sha256 ? openingSoundPath(sound) : null;
  }

  /**
   * Load the opening pack…: its photo 1 brought into Media and made the opening's photo, and its sound (or none) the
   * opening's sound, replacing what was chosen before. A pack without its photo 1, or whose sound Drashti cannot take,
   * says why, and nothing changes.
   */
  async loadPack(dir: string): Promise<OpeningResult> {
    const pack = await readPack(dir);
    const notLoaded = () => {
      this.deps.log('Opening: the opening pack was not loaded');
    };
    if (!pack.ok) {
      notLoaded();
      return pack;
    }
    const imported = await this.deps.importPhotos([pack.photo]);
    if (!imported.ok) {
      notLoaded();
      return imported;
    }
    const [photo] = imported.ids;
    if (photo === undefined || this.deps.picture(photo) === null) {
      notLoaded();
      return {
        ok: false,
        message: `In the opening pack, ${basename(pack.photo)} did not come into Media as a picture. Nothing was changed.`,
      };
    }
    let sound: OpeningSound | null = null;
    if (pack.sound) {
      const copied = await keepSoundCopy(this.deps.mediaDir, pack.sound);
      if (!copied.ok) {
        notLoaded();
        return copied;
      }
      sound = copied.sound;
    }
    const before = this.kept();
    this.keep({ on: before.on, photo, sound });
    // The sound it replaced goes, unless it is the very file kept now (the same pack loaded again).
    const same = sound !== null && before.sound?.sha256 === sound.sha256 && before.sound.kind === sound.kind;
    if (before.sound && !same) await dropSoundCopy(this.deps.mediaDir, before.sound);
    this.deps.log(`Opening: the opening pack’s photo ${sound ? 'and sound are' : 'is'} the opening’s now`);
    return { ok: true, view: this.view() };
  }

  /** A photo's copy for the opening, from the operator window. */
  async saveCopy(mediaId: string, bytes: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    const picture = typeof mediaId === 'string' ? this.deps.picture(mediaId) : null;
    if (!picture) return { ok: false, message: 'That photo is not in Media.' };
    return saveOpeningCopy(this.deps.mediaDir, picture.sha256, bytes);
  }
}
