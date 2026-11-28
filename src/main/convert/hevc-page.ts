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

/**
 * The questions' own views while they ask (alpha.21: held by nothing, a view no window holds was taken by a garbage
 * collection with its page and its question, which then never answered: 2 of alpha.20's 5 starts on the owner's Mac,
 * and CI's start-marks.spec:48 late in a run). Held here until each has answered or gone.
 */
const asking = new Set<WebContentsView>();

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
  const view = new WebContentsView({ webPreferences });
  asking.add(view);
  const contents = view.webContents;
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
    asking.delete(view);
    if (!contents.isDestroyed()) contents.close();
  };
  contents.once('render-process-gone', close);
  // Gone for any other reason: its questions are not known, never left waiting.
  contents.once('destroyed', close);
  void contents
    .loadURL('about:blank')
    .then(async () => {
      // Keep the blank probe's identity (launch/quit tracking), but give its document no resource authority.
      // Main's explicit executeJavaScript calls ask the codec questions; the page itself loads no script.
      await contents.executeJavaScript(`(() => {
        const policy = document.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
        document.head.prepend(policy);
      })()`);
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
