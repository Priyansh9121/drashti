import { copyElements, pasteElements } from './clipboard';
import { commit, tell, useEditor } from './editor-store';
import { deleteElements, duplicateElements } from './ops';

export function copySelectedObjects(cut = false): void {
  const { doc, slideId, selection, editing } = useEditor.getState();
  if (!doc || !slideId || editing || selection.length === 0) return;
  const count = copyElements(doc, slideId, selection);
  if (cut && count > 0) commit(deleteElements(doc, slideId, selection), { select: [] });
  else if (count > 0) tell(count === 1 ? 'Copied 1 element.' : `Copied ${count} elements.`);
}

export function pasteSelectedObjects(inPlace = false): void {
  const { doc, slideId, editing } = useEditor.getState();
  if (!doc || !slideId || editing) return;
  const pasted = pasteElements(doc, slideId, { inPlace });
  if (pasted) commit(pasted.doc, { select: pasted.ids });
}

export function duplicateSelectedObjects(): void {
  const { doc, slideId, selection, editing } = useEditor.getState();
  if (!doc || !slideId || editing || selection.length === 0) return;
  const copy = duplicateElements(doc, slideId, selection);
  commit(copy.doc, { select: copy.ids });
}

export function deleteSelectedObjects(): void {
  const { doc, slideId, selection, editing } = useEditor.getState();
  if (doc && slideId && !editing && selection.length > 0)
    commit(deleteElements(doc, slideId, selection), { select: [] });
}
