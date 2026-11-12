import type { ImportIssue } from '../../../shared/import';
import { legacyFontOf } from '../legacy-fonts';
import { parseXml, XmlError } from '../xml';
import { iterateZipEntries } from '../zip';

/** Themes, inherited text properties, and text runs on slides and in their drawings. */
const FONT_PART =
  /^ppt\/(?:presentation\.xml|(?:theme|slides|slideLayouts|slideMasters|charts|diagrams)\/[^/]+\.xml)$/u;

export async function readDeckFontIssues(path: string): Promise<ImportIssue[]> {
  const fonts = new Map<string, string>();
  try {
    for await (const [, bytes] of iterateZipEntries(path, (name) => FONT_PART.test(name))) {
      if (!bytes.includes('typeface')) continue;
      try {
        const nodes = [parseXml(bytes.toString('utf8'))];
        for (const node of nodes) {
          for (const child of node.children) nodes.push(child);
          const font = legacyFontOf(node.attrs['typeface']?.trim());
          if (font && !fonts.has(font.name.toLowerCase())) fonts.set(font.name.toLowerCase(), font.name);
        }
      } catch (error) {
        if (!(error instanceof XmlError)) throw error;
      }
    }
  } catch {
    // A font check is advisory. A part the reader cannot open must not stop the deck import.
  }
  return [...fonts.values()].map((font) => ({
    severity: 'warning',
    code: 'legacy-font',
    message: `This deck names the old font “${font}”. Install it on this computer and on each node, then quit and start Drashti again on each.`,
    fix: { kind: 'convert-font', font },
  }));
}
