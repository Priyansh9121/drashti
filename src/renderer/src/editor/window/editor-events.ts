import type { EditSlidesOpen } from '../../../../shared/slide-edit';
import { askBeforeClosing, isDirty, switchTo, type EditorView } from '../editor-store';
import { finishTextEditing } from '../TextBoxEditor';

/** Changes the editor's window must protect when it is closed or asked to open other slides. */
export const editorHasChanges = (state: EditorView): boolean => isDirty(state) || state.editing !== null;

/** The operator asks this window to edit a presentation, possibly at another slide. */
export function editAsked(open: EditSlidesOpen): void {
  finishTextEditing();
  switchTo(open);
}

/** The window's close button asks its page whether anything needs keeping first. */
export function closeAsked(): void {
  finishTextEditing();
  askBeforeClosing();
}
