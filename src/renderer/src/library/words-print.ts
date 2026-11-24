import { type WordsPrinted, wordsPrintedText } from '../../../shared/words-print';
import { addFileMenuItems, type FileTarget } from '../files/file-menu';
import { useNotice } from '../operator/actions';
import { FileText, Printer } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';

/*
 * A singers' sheet (alpha.22): Print words… and Save words as PDF… in the one right-click menu (files/file-menu.ts), on
 * a presentation in the library, in Pro Mode's menu only (the main process refuses them in Simple Mode too). The page
 * is made and printed by the main process (src/main/words-print.ts), never while the show is live; what it answers is
 * said as a notice.
 */

/** How the two ask the main process (the window's bridge; a test's stand-in). */
export interface WordsPrintCalls {
  print: (presentationId: string) => Promise<WordsPrinted>;
  pdf: (presentationId: string) => Promise<WordsPrinted>;
}

const bridge: WordsPrintCalls = {
  print: (id) => window.drashti.library.printWords(id),
  pdf: (id) => window.drashti.library.saveWordsPdf(id),
};

const notice = (text: string) => {
  useNotice.setState({ text });
};

/** The menu's two entries for a presentation in the library; none for anything else. */
export function wordsPrintItems(
  target: FileTarget,
  say: (text: string) => void = notice,
  calls: WordsPrintCalls = bridge,
): MenuEntry[] {
  const id = target.presentationId;
  if (target.kind !== 'presentation' || target.place !== 'library' || !id) return [];
  const run = (ask: (presentationId: string) => Promise<WordsPrinted>) => () => {
    void ask(id).then((result) => {
      const text = wordsPrintedText(target.name, result);
      if (text !== null) say(text);
    });
  };
  return [
    { label: 'Print words…', icon: Printer, onSelect: run(calls.print) },
    { label: 'Save words as PDF…', icon: FileText, onSelect: run(calls.pdf) },
  ];
}

/** Put the two in Pro Mode's menu, while its window is up: returns how to take them out. */
export function addWordsPrintToMenu(): () => void {
  return addFileMenuItems((target) => wordsPrintItems(target));
}
