import { holdLineClock } from './undo';

/**
 * Tests only (QA23-UNDOLINE-1): the Undo line's clock held, moved on by the test (drashtiTestUndoLineLater), so a test
 * sees the line there at 59 s and gone at 60 without waiting a minute. Main adds this query only under
 * DRASHTI_TEST_UNDO_LINE, never when packaged (main/windows/renderer.ts). Nothing else changes.
 */
export function installUndoLineTestIfAsked(): void {
  if (new URLSearchParams(location.search).get('undoLineTest') !== '1') return;
  Object.assign(globalThis, { drashtiTestUndoLineLater: holdLineClock() });
}
