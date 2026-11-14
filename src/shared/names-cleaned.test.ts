import { describe, expect, it } from 'vitest';
import { nodeNameFrom, nodeNameSchema } from './nodes-schema';
import { newItemsSchema, slotSchema, templateRequestSchema } from './playlists';
import { stageLayoutNameSchema } from './stage-layouts';

/*
 * The names still only trimmed before C15 (Session 58, FT-1; X3's "Not changed" list) get X3's cleaning, on input only:
 * a tab or a line break becomes a space, hidden text-direction marks are left out, and a name with nothing visible in
 * it is refused like an empty one (shared/rename-name.ts).
 */

/** A zero-width space, a word joiner and a soft hyphen: nothing a person sees. */
const NOTHING = '\u200B\u2060\u00AD';
/** A name with a hidden direction mark (copied words can bring one), and one with a tab. */
const MARKED = 'Placeholder\u200E hall';
const TABBED = 'Placeholder\thall';
const KEPT = 'Placeholder hall';

describe('names given to Drashti, cleaned as Rename… cleans one (C15, FT-1)', () => {
  it('a node’s name, renamed or as it pairs', () => {
    expect(nodeNameSchema.safeParse(NOTHING).success).toBe(false);
    expect(nodeNameSchema.parse(MARKED)).toBe(KEPT);
    expect(nodeNameSchema.parse(TABBED)).toBe(KEPT);
    // Its computer's name as it pairs: nothing visible left is "Node", as an empty one is.
    expect(nodeNameFrom(`${NOTHING}.local`)).toBe('Node');
    expect(nodeNameFrom('Placeholder\u202E-Mac.local')).toBe('Placeholder-Mac');
  });

  it('a stage layout’s', () => {
    expect(stageLayoutNameSchema.safeParse(NOTHING).success).toBe(false);
    expect(stageLayoutNameSchema.parse(MARKED)).toBe(KEPT);
  });

  it('a template’s, a slot’s label and category, and a header’s as it is added', () => {
    expect(templateRequestSchema.safeParse({ name: NOTHING, slots: [] }).success).toBe(false);
    expect(templateRequestSchema.parse({ name: MARKED, slots: [] }).name).toBe(KEPT);
    expect(slotSchema.safeParse({ label: NOTHING, category: null }).success).toBe(false);
    expect(slotSchema.safeParse({ label: KEPT, category: NOTHING }).success).toBe(false);
    expect(slotSchema.parse({ label: TABBED, category: MARKED })).toEqual({ label: KEPT, category: KEPT });
    expect(newItemsSchema.safeParse([{ kind: 'header', label: NOTHING }]).success).toBe(false);
    expect(newItemsSchema.parse([{ kind: 'header', label: MARKED }])).toEqual([
      { kind: 'header', label: KEPT },
    ]);
  });
});
