import { groupedSelection } from '../../../shared/element-groups';
import { legacyFontOf, type EditDoc, type EditSlide } from '../../../shared/slide-edit';
import { Menu, type MenuPlace } from '../ui/Menu';
import { groupElements, ungroupElements } from './arrange-ops';
import { hasCopied } from './clipboard';
import { commit, startEditing, useEditor } from './editor-store';
import {
  copySelectedObjects,
  deleteSelectedObjects,
  duplicateSelectedObjects,
  pasteSelectedObjects,
} from './object-actions';
import type { SlideObject } from './objects';
import { arrange, canMoveInOrder } from './ops';

export function ObjectMenu({
  at,
  slide,
  target,
  onClose,
}: {
  at: MenuPlace;
  slide: EditSlide;
  target: string | null;
  onClose: () => void;
}) {
  const selection = useEditor((s) => s.selection);
  const empty = selection.length === 0;
  const grouped = groupedSelection(slide.elements, selection);
  const inGroup = slide.elements.some((el) => el.groupId && selection.includes(el.id));
  const text: SlideObject | undefined = slide.elements.find((el) => el.id === target);
  const canEdit = text?.kind === 'text' && !text.hidden && legacyFontOf(text) === null;
  const change = (action: (doc: EditDoc, ids: string[]) => EditDoc, expand = false) => {
    const now = useEditor.getState();
    if (!now.doc || now.slideId !== slide.id) return;
    const ids = expand ? groupedSelection(slide.elements, now.selection) : now.selection;
    commit(action(now.doc, ids), { select: ids });
  };
  return (
    <Menu
      at={at}
      label="Slide objects"
      onClose={onClose}
      entries={[
        { label: 'Cut', disabled: empty, onSelect: () => copySelectedObjects(true) },
        { label: 'Copy', disabled: empty, onSelect: () => copySelectedObjects() },
        { label: 'Paste', disabled: !hasCopied(), onSelect: () => pasteSelectedObjects() },
        {
          label: 'Duplicate',
          disabled: empty,
          separatorBefore: true,
          onSelect: duplicateSelectedObjects,
        },
        { label: 'Delete', disabled: empty, danger: true, onSelect: deleteSelectedObjects },
        {
          label: 'Bring forward',
          disabled: !canMoveInOrder(slide.elements, selection, 1),
          separatorBefore: true,
          onSelect: () => change((doc, ids) => arrange(doc, slide.id, ids, 'forward')),
        },
        {
          label: 'Send backward',
          disabled: !canMoveInOrder(slide.elements, selection, -1),
          onSelect: () => change((doc, ids) => arrange(doc, slide.id, ids, 'backward')),
        },
        {
          label: 'Group',
          disabled: grouped.length < 2,
          onSelect: () => change((doc, ids) => groupElements(doc, slide.id, ids), true),
        },
        {
          label: 'Ungroup',
          disabled: !inGroup,
          onSelect: () => change((doc, ids) => ungroupElements(doc, slide.id, ids), true),
        },
        {
          label: 'Edit text',
          disabled: !canEdit,
          separatorBefore: true,
          onSelect: () => {
            if (canEdit) startEditing(text.id);
          },
        },
      ]}
    />
  );
}
