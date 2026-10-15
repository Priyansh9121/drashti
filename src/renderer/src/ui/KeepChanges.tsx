import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

/*
 * The one question asked when a dialog or editor with typed changes is closed (its close button,
 * Esc or Cancel), Session 25. Save changes is the primary and has the focus (decided 15 Oct 2026,
 * Session 26g: saving is what people mean nine times in ten), so Enter saves; but when saving would
 * change what the screens show now (the live presentation), the question says so in plain words and
 * Keep editing has the focus, so Enter never changes the screens by accident (Session 26h, as Session
 * 25 had it). Esc always keeps editing, and Throw them away (danger) is never the default. Where
 * there is nothing to save yet (the setup wizard sets things only at Finish), it asks without Save
 * changes, and Keep editing has the focus.
 */

export function KeepChangesDialog({
  name,
  lost,
  live,
  note,
  onKeepEditing,
  onSave,
  onThrowAway,
  saving = false,
}: {
  /** What was changed, as the title names it: “Kirtan 2”, the markers of “Clip”. */
  name: ReactNode;
  /** How much would be lost: "You changed 3 lines." */
  lost: ReactNode;
  /** When saving changes the screens at once (the live presentation): said plainly, and Keep editing has the focus. */
  live?: ReactNode;
  /** Anything else worth knowing before choosing (what saving does when not live). */
  note?: ReactNode;
  onKeepEditing: () => void;
  /** Save, then close. Left out: there is nothing to save from here. */
  onSave?: () => void;
  onThrowAway: () => void;
  saving?: boolean;
}) {
  const textId = useId();
  return (
    <Dialog
      title={<>Keep your changes to {name}?</>}
      titleWraps
      role="alertdialog"
      size="sm"
      onClose={onKeepEditing}
      closeButton={false}
      describedBy={textId}
      testId="keep-changes"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            data-autofocus={onSave && !live ? undefined : ''}
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button variant="danger" onClick={onThrowAway}>
            Throw them away
          </Button>
          {onSave && (
            <Button
              variant="primary"
              data-autofocus={live ? undefined : ''}
              disabled={saving}
              onClick={onSave}
            >
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div id={textId} className="space-y-2 text-sm text-muted">
        <p>{lost} If you close now, they are thrown away.</p>
        {live && (
          <p className="font-medium text-warning-fg" data-testid="keep-changes-live">
            {live}
          </p>
        )}
        {note && <p>{note}</p>}
      </div>
    </Dialog>
  );
}

/** The live presentation's warning: saving its words or slides changes the screens in the same moment. */
export const savesLive = (name: string): string =>
  `“${name}” is on the screens now: saving changes them at once.`;

/** What saving a presentation that is not on the screens does. */
export const SAVES_LIBRARY =
  'Saving changes the presentation in the library; the screens show it the next time it goes up.';

/** How many lines differ between two texts: the larger of those added and those taken out. */
export function linesChanged(before: string, after: string): number {
  const count = (text: string) => {
    const lines = new Map<string, number>();
    for (const line of text.split('\n')) lines.set(line, (lines.get(line) ?? 0) + 1);
    return lines;
  };
  const was = count(before);
  const now = count(after);
  let added = 0;
  let removed = 0;
  for (const [line, n] of now) added += Math.max(0, n - (was.get(line) ?? 0));
  for (const [line, n] of was) removed += Math.max(0, n - (now.get(line) ?? 0));
  return Math.max(added, removed);
}

/** How many settings differ between two values (each leaf of the objects counts once). */
export function settingsChanged(before: unknown, after: unknown): number {
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null)
    return Object.is(before, after) ? 0 : 1;
  if (Array.isArray(before) || Array.isArray(after))
    return JSON.stringify(before) === JSON.stringify(after) ? 0 : 1;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let n = 0;
  for (const key of keys)
    n += settingsChanged((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]);
  return n;
}
