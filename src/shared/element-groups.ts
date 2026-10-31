import type { SlideElement } from './model';

/** Selecting one member selects its flat group, local to this slide. */
export function groupedSelection(elements: readonly SlideElement[], ids: readonly string[]): string[] {
  const selected = new Set<string>();
  for (const id of ids) {
    const element = elements.find((el) => el.id === id);
    if (!element) continue;
    if (element.groupId) {
      for (const member of elements) if (member.groupId === element.groupId) selected.add(member.id);
    } else selected.add(id);
  }
  return [...selected];
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
