import { Button } from '../../ui/Button';
import { Undo2 } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { usePhoneTools } from './phone-tools-store';

/*
 * The last change made on this phone that has an Undo (Session 55, Part 9): a row taken out of the playlist, a file or
 * presentation renamed, a wallpaper deleted. Said where it was made, under the rows or the wallpapers, with Undo.
 */

/** The last change made here with an Undo, under the rows (or the wallpapers). */
export function UndoLine({ where, testId }: { where: 'rows' | 'wallpapers'; testId: string }) {
  const undo = usePhoneTools((s) => (s.undo?.where === where ? s.undo : null));
  if (!undo) return null;
  return (
    <Notice tone="info" onDismiss={() => usePhoneTools.setState({ undo: null })}>
      <span className="flex flex-wrap items-center gap-2">
        <span>{undo.text}</span>
        <Button
          size="lg"
          className="min-h-12"
          icon={Undo2}
          data-testid={testId}
          onClick={() => {
            usePhoneTools.setState({ undo: null });
            void undo.undo();
          }}
        >
          Undo
        </Button>
      </span>
    </Notice>
  );
}
