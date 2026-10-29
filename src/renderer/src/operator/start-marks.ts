import { useEffect } from 'react';
import { START_MARKS, type StartMarks } from '../../../shared/start-marks';

/*
 * The operator window's own start (question 36 of Session 54): the first moment it knew each thing it waits for
 * before it draws its controls, and drew them, told once to the main process for the log (shared/start-marks.ts).
 */

const marks: Partial<StartMarks> = {};
let told = false;

function markStart(name: keyof StartMarks): void {
  marks[name] ??= Date.now();
  if (told || !START_MARKS.every((m) => marks[m] !== undefined)) return;
  told = true;
  void window.drashti.app.windowStarted(marks as StartMarks).catch(() => undefined);
}

/**
 * The App's start, marked as it happens: the App itself shows only once the window's access lets it in (AccessGate),
 * and draws its controls once it knows its mode and the single-letter keys; the version comes on its own.
 */
export function useStartMarks(modeKnown: boolean, keysKnown: boolean, infoKnown: boolean): void {
  useEffect(() => {
    markStart('access');
  }, []);
  useEffect(() => {
    if (modeKnown) markStart('mode');
  }, [modeKnown]);
  useEffect(() => {
    if (keysKnown) markStart('keys');
  }, [keysKnown]);
  useEffect(() => {
    if (infoKnown) markStart('info');
  }, [infoKnown]);
  useEffect(() => {
    if (modeKnown && keysKnown) markStart('drawn');
  }, [modeKnown, keysKnown]);
}
