import { z } from 'zod';

/*
 * A name a person gives, cleaned the same way on the computer and on a phone, so both keep the same name for every
 * input: Rename… of a picture, video, sound or presentation, and (Session 58, X3) the names of playlists, audio
 * playlists, wallpapers, screens and screen groups.
 * - a tab or a line break (U+0009–U+000D, U+0085, U+2028, U+2029) becomes a space, so the words either side stay
 *   apart;
 * - control characters (C0, DEL and C1) and the text-direction marks, embeddings and isolates (Unicode's
 *   Bidi_Control: U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) are left out;
 * - spaces at either end are trimmed;
 * - a name with nothing visible left (only spaces, joiners, zero-width spaces, word joiners, soft hyphens, fillers, or
 *   marks with no letter) is empty, so it is refused like an empty one.
 * Letters, marks and joiners inside a name stay as typed (Gujarati's and Hindi's ZWJ and ZWNJ, nukta, virama and vowel
 * signs; emoji sequences; a no-break space), and nothing is normalized: what was typed is what is kept. A name kept
 * before is never cleaned again, except by Rename's Undo, which is itself a rename to the old name.
 */

/** A character that shows: not a space, a format character (the joiners among them), a mark alone or a filler. */
const VISIBLE = /[^\p{Z}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/u;

/** A name as it is kept: cleaned as above, so empty when nothing visible is left. */
export function cleanRenameName(name: string): string {
  const cleaned = name
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/gu, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .trim();
  return VISIBLE.test(cleaned) ? cleaned : '';
}

/** A name where a request brings one: cleaned as above, then 1 to `max` characters (as a text field counts them). */
export const cleanNameSchema = (max: number) =>
  z.string().transform(cleanRenameName).pipe(z.string().min(1).max(max));

/** Drashti's answer to Rename…: kept, or why not, in the words the window and a phone show. */
export type RenameAnswer = { ok: true } | { ok: false; message: string };
