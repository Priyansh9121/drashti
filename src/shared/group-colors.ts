/*
 * The default colours of groups (Verse, Chorus…), Session 26g: shown as a strip beside a slide's
 * number, never behind text. Chorus starts teal and Verse indigo; there is no red among them,
 * because red sits too close to LIVE: every one is at least 10 (CIEDE2000) from the live colour in
 * usual colour vision and in simulated protanopia, deuteranopia and tritanopia
 * (group-colors.test.ts). Groups already made, and colours a presentation brings with it (an
 * import from ProPresenter, say), keep their own.
 */

export const GROUP_COLOURS = {
  teal: '#12a594',
  indigo: '#3e63dd',
  orange: '#f76b15',
  purple: '#8e4ec6',
  amber: '#ffc53d',
  cyan: '#00a2c7',
} as const;

/** The colours offered for a group, in the order a new group takes them. */
export const GROUP_COLORS = [
  GROUP_COLOURS.teal,
  GROUP_COLOURS.indigo,
  GROUP_COLOURS.orange,
  GROUP_COLOURS.purple,
  GROUP_COLOURS.amber,
  GROUP_COLOURS.cyan,
] as const;

/** The usual colours for the usual group names, so groups stand apart in the slide grid. */
export function groupColor(name: string): string | null {
  const n = name.toLowerCase().replace(/[\d\s.:#-]+$/u, '');
  const starts = (...prefixes: string[]) => prefixes.some((p) => n.startsWith(p));
  if (starts('verse', 'stanza', 'pad')) return GROUP_COLOURS.indigo;
  if (starts('pre-chorus', 'prechorus')) return GROUP_COLOURS.orange;
  if (starts('chorus', 'refrain', 'tek', 'ટેક', 'टेक')) return GROUP_COLOURS.teal;
  if (starts('bridge')) return GROUP_COLOURS.purple;
  if (starts('intro', 'outro', 'ending', 'tag', 'coda')) return GROUP_COLOURS.cyan;
  return null;
}

/** A new group's colour: its name's usual colour, else the first default no other group uses. */
export function newGroupColor(name: string, used: ReadonlySet<string | null>): string {
  return groupColor(name) ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[0];
}
