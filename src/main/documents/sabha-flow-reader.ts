import type { SabhaFlow } from '../../shared/sabha-flow';
import type { FlowTextPage } from '../../shared/sabha-flow-text';

/*
 * Sabha flow (alpha.23): the reader. From a PDF's text layer (shared/sabha-flow-text.ts), its numbered items.
 */

/** What reading a PDF finds (Main adds the id, the file's name and the page count). */
export type FlowReading = Pick<SabhaFlow, 'status' | 'lang' | 'headers' | 'items'> &
  Partial<Pick<SabhaFlow, 'title' | 'subtitle' | 'total'>>;

export function readSabhaFlow(pages: readonly FlowTextPage[]): FlowReading {
  void pages;
  return { status: 'no-items', lang: 'mixed', headers: [], items: [] };
}
