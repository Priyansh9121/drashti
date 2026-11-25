import type { SabhaFlowReading } from '../../../shared/sabha-flow';
import { readSabhaFlow } from '../../../shared/sabha-flow-reader';
import { flowRulesOf, flowTextsOf, type FlowOps, type FlowTextPage } from '../../../shared/sabha-flow-text';

/*
 * Sabha flow (alpha.23): the hidden pictures window's part (review M1). Each page's text layer and borders are taken
 * from pdf.js after its picture is made, and once every page is drawn the flow is read from them here, never in Main
 * (Main only checks what comes, shared/sabha-flow.ts sabhaFlowReadingSchema). This window's process runs at the lowest
 * priority, so the show never waits for the reading. Neither step can cost a page its picture, and neither ends in
 * anything but a plain status.
 */

/** What reading a page's text layer needs of pdf.js's page. */
export interface FlowPdfPage {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(params?: { intent?: string; annotationMode?: number }): Promise<{
    fnArray: ArrayLike<number>;
    argsArray: ArrayLike<unknown>;
  }>;
}

/** pdf.js's AnnotationMode.DISABLE: comments are notes, not part of the page (as the picture is drawn). */
const ANNOTATIONS_OFF = 0;

/**
 * A page's text layer and borders where they stand (the page at scale 1, its rotation applied), or null when pdf.js
 * could not give them (review S4: the page's picture still goes). The operator list asked for is the one the drawing
 * made ('print'), which pdf.js keeps, so the page is not read a second time.
 */
export async function flowPageSafely(page: FlowPdfPage, ops: FlowOps): Promise<FlowTextPage | null> {
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const list = await page.getOperatorList({ intent: 'print', annotationMode: ANNOTATIONS_OFF });
    return {
      width: viewport.width,
      height: viewport.height,
      texts: flowTextsOf(content, viewport),
      rules: flowRulesOf(list, ops, viewport),
    };
  } catch {
    return null;
  }
}

/**
 * The flow read from its pages' text layers: what the reader finds, or null should it fail (the window then says so
 * with `done`; Main logs why and shows the flow as unreadable, its pages shown).
 */
export function readFlowSafely(
  pages: readonly FlowTextPage[],
  read: (pages: readonly FlowTextPage[]) => SabhaFlowReading = readSabhaFlow,
): SabhaFlowReading | null {
  try {
    return read(pages);
  } catch {
    return null;
  }
}
