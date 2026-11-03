/** Only the Studio's observed, intended discard closure may end its own click. */
export interface StudioDiscardState {
  studioClosed: boolean;
  studioCrashed: boolean;
  operatorClosed: boolean;
  operatorCrashed: boolean;
  appClosed: boolean;
  mainExited: boolean;
  studioIsClosed: boolean;
  studioStillListed: boolean;
  parentAlive: boolean;
}

/**
 * The colour codes Playwright writes around each line of an error's call log where colours are on (on CI, not on this
 * Mac: alpha.14's quick check on Windows, 4 Nov 2026, run 41717420786), taken out before the words are read.
 */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

export function isExpectedStudioDiscardClose(
  error: unknown,
  state: Readonly<Record<keyof StudioDiscardState, unknown>>,
): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.replace(/\r\n/gu, '\n').replace(COLOUR, '');
  const discard = "getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' })";
  return (
    message.split('\n')[0] === 'locator.click: Target page, context or browser has been closed' &&
    message.includes(`waiting for ${discard}`) &&
    /^\s*- performing click action\s*$/mu.test(message) &&
    state.studioClosed === true &&
    state.studioCrashed === false &&
    state.operatorClosed === false &&
    state.operatorCrashed === false &&
    state.appClosed === false &&
    state.mainExited === false &&
    state.studioIsClosed === true &&
    state.studioStillListed === false &&
    state.parentAlive === true
  );
}
