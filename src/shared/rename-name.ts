/*
 * A name a person gives to Rename… (a picture, video, sound or presentation), cleaned the same way on the computer
 * and on a phone, so both keep the same name for every input:
 * - a tab or a line break (U+0009–U+000D, U+0085, U+2028, U+2029) becomes a space, so the words either side stay
 *   apart;
 * - control characters (C0, DEL and C1) and the text-direction marks, embeddings and isolates (Unicode's
 *   Bidi_Control: U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) are left out;
 * - spaces at either end are trimmed.
 * Letters, marks and joiners stay as typed (Gujarati's and Hindi's ZWJ and ZWNJ, nukta, virama and vowel signs; emoji
 * sequences; a no-break space inside a name), and nothing is normalized: what was typed is what is kept.
 */

/** A name as Rename… keeps it: cleaned as above. */
export function cleanRenameName(name: string): string {
  return name
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/gu, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .trim();
}
