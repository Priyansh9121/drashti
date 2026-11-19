import { queueFit, type FitBox } from './shrink-to-fit';

/**
 * Tests only (X15 / MS-2): a queued measurement report that throws, followed by one that succeeds. This uses the
 * window's actual fit queue and error registration. Main adds this query only under DRASHTI_TEST_FIT_FAILURES,
 * never when packaged (main/windows/renderer.ts). It registers no error handler and changes no real slide.
 */
export function installFitFailureTestIfAsked(): void {
  if (new URLSearchParams(location.search).get('fitFailureTest') !== '1') return;
  // Reuse the same failure, including its stack, so repeated measurements also exercise report-once.
  const error = new Error('Placeholder fit report failure');
  const box = (settle: FitBox['settle']): FitBox => ({
    on: false,
    write: () => undefined,
    over: () => false,
    settle,
  });
  Object.assign(globalThis, {
    drashtiTestFitFailure: () =>
      new Promise<void>((resolve) => {
        queueFit(
          box(() => {
            throw error;
          }),
        );
        queueFit(box(() => resolve()));
      }),
  });
}
