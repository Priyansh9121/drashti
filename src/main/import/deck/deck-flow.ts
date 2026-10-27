import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ImportIssue } from '../../../shared/import';
import type { PictureSource } from '../../../shared/pictures';
import type { Converter } from '../deck-converters';
import type { ParsedPresentation } from '../model';
import type { PptxDeck } from '../pictures';
import { type BakeOptions, bakeDeck, type BakeResult } from './bake';
import { bakedPresentation, whyPictures } from './deck-import';
import type { Baker } from './plan';

/*
 * A PowerPoint or Keynote file at import (Session 54, C2): with its animations where this computer can make them,
 * else as pictures, as before. The apps that can make its movie are tried in turn (PowerPoint first for its own
 * files, then Keynote on a Mac), only while one could not at all; a movie off its plan, the stream on air or a
 * cancel stops there. Then the import (pipeline.ts) writes the deck with its steps, or its pictures: those the app
 * saved as it went, or saved as PDF as before.
 */

export type DeckFlow =
  | { kind: 'baked'; parsed: ParsedPresentation }
  | {
      kind: 'pictures';
      /** The pictures an app saved while it tried (null: save them as PDF as before). */
      pdf: string | null;
      converter: Converter | null;
      /** The deck as it was read, for its videos and sounds, and the file they are in. */
      deck: PptxDeck | null;
      deckFile: string | null;
      /** Why it came in as pictures, for the report (none when nothing here could make its movie). */
      issues: ImportIssue[];
      cancelled: boolean;
    };

export interface DeckFlowRequest {
  source: Exclude<PictureSource, 'pdf'>;
  file: string;
  fileName: string;
  sourcePath: string;
  /** The .pptx as read already (null for an old .ppt or a Keynote file). */
  read: PptxDeck | null;
  /** A folder of its own. */
  work: string;
  /** What can make its movie here, in the order to try. */
  bakers: Baker[];
}

const APP: Record<Baker, string> = {
  powerpoint: 'PowerPoint',
  keynote: 'Keynote',
  'stand-in': 'The stand-in',
};

export async function runDeck(
  request: DeckFlowRequest,
  options: BakeOptions & {
    onAir: () => Promise<boolean>;
    /** The deck came in as pictures before: if its animations cannot be made, that import is kept as it was. */
    kept?: boolean;
    /** Keynote or PowerPoint started by Drashti itself (Session 31: the leftovers record). */
    appStarted?: (pid: number, app: 'PowerPoint' | 'Keynote') => void;
  },
): Promise<DeckFlow> {
  const { source, file, read, bakers } = request;
  const pictures = (result: Extract<BakeResult, { ok: false }> | null, issues: ImportIssue[]): DeckFlow => ({
    kind: 'pictures',
    pdf: result?.pdf ?? null,
    converter: result?.pdf && result.baker !== 'stand-in' ? result.baker : null,
    deck: result?.deck ?? read,
    deckFile: result?.deckFile ?? (source === 'pptx' ? file : null),
    issues,
    cancelled: result?.why.kind === 'cancelled',
  });
  const first = bakers[0];
  if (!first) return pictures(null, []);
  // Never while the stream is on air or recording (Session 50's rule for converting).
  if (await options.onAir()) return pictures(null, [whyPictures({ kind: 'on-air' }, first, options.kept)]);
  const tried: { baker: Baker; reason: string }[] = [];
  let last: Extract<BakeResult, { ok: false }> | null = null;
  for (const baker of bakers) {
    const work = await mkdtemp(join(request.work, 'bake-'));
    const result = await bakeDeck(
      baker,
      { source, input: file, read, work },
      {
        ...options,
        started: (pid) => options.appStarted?.(pid, baker === 'keynote' ? 'Keynote' : 'PowerPoint'),
      },
    );
    if (result.ok) {
      const parsed = await bakedPresentation(
        request.fileName,
        request.sourcePath,
        result.baked,
        work,
        options.ffmpeg,
        dirname(file),
      );
      const before = tried[0];
      if (before)
        parsed.issues.unshift({
          severity: 'warning',
          code: 'deck-other-app',
          message: `${APP[before.baker]} could not make the deck’s movie (${before.reason}), so ${APP[baker]} did: check that its slides look right.`,
          fix: null,
        });
      return { kind: 'baked', parsed };
    }
    last = result;
    // Only an app that could not do it at all gives way to the next.
    if (result.why.kind !== 'app') break;
    tried.push({ baker, reason: result.why.reason });
  }
  return pictures(last, last ? [whyPictures(last.why, last.baker, options.kept)] : []);
}
