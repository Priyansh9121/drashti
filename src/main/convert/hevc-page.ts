import { WebContentsView } from 'electron';
import { secureWebPreferences } from '../windows/web-preferences';
import { askHevcQuestions, type HevcKinds } from './plays-hevc';

/*
 * The HEVC question's own page (question 36 of Session 54). Chromium answers whether it plays HEVC only once the GPU
 * process has said which video decoders it has, and until then it holds the page that asked, which can then do
 * nothing else: on CI's Mac late in a run that took about 15 s, and the operator window, which was asked as it loaded,
 * drew nothing and heard nothing meanwhile (its access, mode, keys and version all waited). So the question is asked
 * in a page of its own, in its own renderer process: a blank page in a hidden view, never a window (nothing counts it
 * as one, and it never shows), sandboxed as every page is and with no bridge to Drashti, gone once it has answered.
 * The operator window never asks it.
 */

/** The question being asked in its own page. */
export interface HevcPage {
  /** Whether this computer plays HEVC; null when the page could not say (its process ended, or it was closed). */
  readonly answer: Promise<boolean | null>;
  /**
   * HEVC's other kinds (Session 60, x36: Main 10, and the Range Extensions), asked in the same page once its first
   * answer came, before that answer is given (so an import waiting for it has both); null when not asked or not told.
   */
  readonly kinds: Promise<HevcKinds | null>;
  /** Closes the page now (Drashti quits): its answer, if still to come, is null. */
  close(): void;
}

/**
 * Ask `script` (plays-hevc.ts's playsHevcScript) in a page of its own, which goes once it has answered; and, given
 * `kindsScript` (hevcKindsScript), HEVC's other kinds in the same page (Session 60, x36).
 */
export function askInOwnPage(script: string, kindsScript: string | null = null): HevcPage {
  const webPreferences: Electron.WebPreferences = { ...secureWebPreferences(), backgroundThrottling: false };
  // A blank page that runs one line: no bridge to Drashti.
  delete webPreferences.preload;
  const contents = new WebContentsView({ webPreferences }).webContents;
  let settle: (answer: boolean | null) => void = () => undefined;
  const answer = new Promise<boolean | null>((resolve) => {
    settle = resolve;
  });
  let settleKinds: (kinds: HevcKinds | null) => void = () => undefined;
  const kinds = new Promise<HevcKinds | null>((resolve) => {
    settleKinds = resolve;
  });
  let closed = false;
  const close = () => {
    settleKinds(null);
    settle(null);
    if (closed) return;
    closed = true;
    if (!contents.isDestroyed()) contents.close();
  };
  contents.once('render-process-gone', close);
  void contents
    .loadURL('about:blank')
    .then(async () => {
      const asked = askHevcQuestions((s) => contents.executeJavaScript(s), script, kindsScript);
      void asked.answer.then(settle);
      void asked.kinds.then(settleKinds);
      // The page goes once both are said (or not known).
      await Promise.all([asked.answer, asked.kinds]);
    })
    .catch(() => {
      settleKinds(null);
      settle(null);
    })
    .finally(close);
  return { answer, kinds, close };
}
