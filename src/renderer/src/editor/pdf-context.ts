// Whether the shown slide is a PDF page, and the editor's PDF pages tab for one.
import type { EditDoc } from '../../../shared/slide-edit';
import type { TabItem } from '../ui/Tabs';
import { FileText } from '../ui/icons';
import type { EditorGroup } from './editor-store';
import { findSlide } from './ops';

export function isPdfPage(doc: EditDoc | null, slideId: string | null): boolean {
  if (!doc || !slideId || doc.master?.id === slideId) return false;
  return findSlide(doc, slideId)?.documentPage?.ext === 'pdf';
}

export function pdfEditorTabs(
  base: readonly TabItem<EditorGroup>[],
  pdfPage: boolean,
): readonly TabItem<EditorGroup>[] {
  return pdfPage ? [...base, { id: 'pdf', label: 'PDF pages', icon: FileText }] : base;
}

/** A remembered PDF tab must never point at a nonexistent panel on another slide. */
export function visibleEditorGroup(group: EditorGroup, pdfPage: boolean): EditorGroup {
  return group === 'pdf' && !pdfPage ? 'slides' : group;
}
