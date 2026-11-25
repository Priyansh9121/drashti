import type { FlowTextPage } from '../../../shared/sabha-flow-text';

/* Sabha flow (alpha.23): the pictures window's reading. Stub. */

export interface FlowPdfPage {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(params?: { intent?: string; annotationMode?: number }): Promise<{
    fnArray: ArrayLike<number>;
    argsArray: ArrayLike<unknown>;
  }>;
}

export function flowPageSafely(
  page: FlowPdfPage,
  ops: Readonly<Record<string, number>>,
): Promise<FlowTextPage | null> {
  void page;
  void ops;
  return Promise.reject(new Error('Not built.'));
}

export function readFlowSafely(
  pages: readonly FlowTextPage[],
  read?: (pages: readonly FlowTextPage[]) => unknown,
): unknown {
  void pages;
  void read;
  throw new Error('Not built.');
}
