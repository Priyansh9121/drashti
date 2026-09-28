import type { ImportIssue } from '../../shared/import';
import type { Lang, TextRun } from '../../shared/model';

/*
 * Legacy (non-Unicode) Gujarati and Hindi fonts (PLAN.md 4.4). Older
 * libraries typed Gujarati in fonts like Gopika or Terafont and Hindi in
 * Kruti Dev: the file holds Latin letters that only look like Gujarati or
 * Hindi in that font. Runs in such fonts keep their font name and are
 * marked legacy, so they still show in that font where it is installed, and
 * the report names each font. A converter for a font (a mapping table to
 * Unicode) can be registered; none ship yet.
 */

/** The same names the audit kit looks for (tools/audit, LEGACY_FONT_RE), with the script each one is for. */
const KNOWN: { pattern: RegExp; script: Lang | null }[] = [
  { pattern: /gopika/iu, script: 'gu' },
  { pattern: /terafont/iu, script: 'gu' },
  { pattern: /lmg[-_ ]/iu, script: 'gu' },
  { pattern: /shree[-_ ]?guj/iu, script: 'gu' },
  { pattern: /sulekh/iu, script: 'gu' },
  { pattern: /shree[-_ ]?dev/iu, script: 'hi' },
  { pattern: /kruti ?dev/iu, script: 'hi' },
  { pattern: /devlys/iu, script: 'hi' },
  { pattern: /chanakya/iu, script: 'hi' },
  { pattern: /aps[-_ ]?dv/iu, script: 'hi' },
  // Families with fonts for more than one script: the report says "Gujarati or Hindi".
  { pattern: /shreelipi|shree lipi/iu, script: null },
  { pattern: /akruti/iu, script: null },
];

export interface LegacyFont {
  /** The font name as the file names it. */
  name: string;
  /** Gujarati or Hindi, when the name says which. */
  script: Lang | null;
}

/** Whether a font is a known legacy Gujarati or Hindi font. */
export function legacyFontOf(name: string | null | undefined): LegacyFont | null {
  if (!name) return null;
  const known = KNOWN.find((k) => k.pattern.test(name));
  return known ? { name, script: known.script } : null;
}

/** Turns one legacy font's codes into Unicode text. */
export interface LegacyConverter {
  /** Which fonts it converts (matched against the font name). */
  matches: (fontName: string) => boolean;
  script: Lang;
  convert: (codes: string) => string;
}

const converters: LegacyConverter[] = [];

/** Add a converter (a font's mapping table). None ship yet. */
export function registerConverter(converter: LegacyConverter): () => void {
  converters.push(converter);
  return () => {
    const i = converters.indexOf(converter);
    if (i >= 0) converters.splice(i, 1);
  };
}

export function converterFor(fontName: string): LegacyConverter | null {
  return converters.find((c) => c.matches(fontName)) ?? null;
}

/** What legacy fonts a presentation used, for its report. */
export class LegacyFontUse {
  private readonly fonts = new Map<string, { script: Lang | null; boxes: number; converted: boolean }>();

  /**
   * Mark the runs of one text box that are typed in legacy fonts, keeping
   * their font. Converts them when a converter for the font is registered.
   */
  apply(runs: TextRun[]): TextRun[] {
    const seen = new Set<string>();
    return runs.map((run) => {
      const name = run.font ?? null;
      const legacy = legacyFontOf(name);
      if (!legacy || !name) return run;
      const converter = converterFor(name);
      if (!seen.has(name)) {
        seen.add(name);
        const use = this.fonts.get(name) ?? {
          script: legacy.script,
          boxes: 0,
          converted: converter !== null,
        };
        use.boxes++;
        this.fonts.set(name, use);
      }
      if (converter) {
        // Unicode now: the bundled font for its script draws it.
        const { font: _font, legacy: _legacy, ...rest } = run;
        return { ...rest, text: converter.convert(run.text), lang: converter.script };
      }
      return { ...run, legacy: true, lang: null };
    });
  }

  issues(): ImportIssue[] {
    return [...this.fonts.entries()].map(([name, use]) => {
      const script = use.script === 'gu' ? 'Gujarati' : use.script === 'hi' ? 'Hindi' : 'Gujarati or Hindi';
      const where = use.boxes === 1 ? 'one text box' : `${use.boxes} text boxes`;
      return use.converted
        ? {
            severity: 'info' as const,
            code: 'legacy-font-converted',
            message: `Text in the legacy ${script} font “${name}” (${where}) was converted to Unicode.`,
            fix: null,
          }
        : {
            severity: 'warning' as const,
            code: 'legacy-font',
            message: `Text in the legacy ${script} font “${name}” (${where}) is kept as typed: it shows correctly only where that font is installed, and cannot be searched or transliterated until it is converted.`,
            fix: { kind: 'convert-font' as const, font: name },
          };
    });
  }
}
