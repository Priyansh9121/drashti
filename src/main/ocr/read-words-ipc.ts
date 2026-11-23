import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import { handle } from '../ipc/handle';
import type { ReadWordsDeps } from './read-words';
import { ReadWords } from './read-words';

/*
 * Read Words from a Page…'s requests (book OCR, alpha.21): the operator window's only, as making a presentation from
 * words is. Simple Mode refuses them (simple-mode.ts), as it refuses New presentation.
 */

const onlyOperator = {
  ok: false as const,
  message: 'Only the operator window can read words into a presentation.',
};

export function registerReadWordsIpc(
  deps: ReadWordsDeps & { fromOperator: (event: IpcMainInvokeEvent) => boolean },
): ReadWords {
  const readWords = new ReadWords(deps);
  handle(IPC.library.readWordsChoose, (e) => (deps.fromOperator(e) ? readWords.choose() : onlyOperator));
  handle(IPC.library.readWords, (e, fromPage, toPage) =>
    deps.fromOperator(e) ? readWords.read(fromPage, toPage) : onlyOperator,
  );
  handle(IPC.library.stopReadingWords, (e) => deps.fromOperator(e) && readWords.stop());
  return readWords;
}
