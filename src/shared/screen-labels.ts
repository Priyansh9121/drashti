/**
 * Each screen's name as the words say it (S1-1, the alpha.24 bug hunt): the red Stopped notice, Screens, the log.
 * Screens are named after their display, so two TVs of one model share a name: the first is said as it is, and each
 * next one of that name with its number among them, "Placeholder TV (2)", never the same words as another screen's own
 * name. In the order given: the groups' and their screens', as Screens lists them, so every place says the same.
 */
export function screenLabels(screens: readonly { id: string; name: string }[]): Map<string, string> {
  const names = new Set(screens.map((s) => s.name));
  const said = new Set<string>();
  const labels = new Map<string, string>();
  for (const s of screens) {
    let label = s.name;
    if (said.has(label)) {
      let n = 2;
      while (said.has(`${s.name} (${String(n)})`) || names.has(`${s.name} (${String(n)})`)) n++;
      label = `${s.name} (${String(n)})`;
    }
    said.add(label);
    labels.set(s.id, label);
  }
  return labels;
}
