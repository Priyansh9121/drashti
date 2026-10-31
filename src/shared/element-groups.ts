import type { SlideElement } from './model';

/** Selecting one member selects its flat group, local to this slide. */
export function groupedSelection(elements: readonly SlideElement[], ids: readonly string[]): string[] {
  const groups = new Set(elements.filter((el) => ids.includes(el.id) && el.groupId).map((el) => el.groupId));
  return elements
    .filter((el) => ids.includes(el.id) || (el.groupId && groups.has(el.groupId)))
    .map((el) => el.id);
}

/** Each pasted or duplicated group has its own identity, never joining the original. */
export function freshGroups(elements: readonly SlideElement[]): SlideElement[] {
  const groups = new Map<string, string>();
  return elements.map((el) => {
    if (!el.groupId) return el;
    let id = groups.get(el.groupId);
    if (!id) {
      id = crypto.randomUUID();
      groups.set(el.groupId, id);
    }
    return { ...el, groupId: id };
  });
}
