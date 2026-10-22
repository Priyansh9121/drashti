import { describe, expect, it } from 'vitest';
import type { EditCue } from '../../shared/slide-edit';
import { cueInputName, editDocSchema } from '../../shared/slide-edit';
import { applySlideEdit, editDocOf } from '../library/slides';
import { openDatabase } from './database';
import { cueFromRow, DbSlideSource, PresentationRepo } from './presentations';

/*
 * A video input as a slide's background cue in the library (Session 51): a background cue with no file, the
 * input's own name in its settings ({"input": "Input 1"}), as a picture's or video's kind is there. It needs no new
 * kind of cue, so the slide_cues table is not built again. Placeholder names only.
 */

const row = (props: string, media: string | null = null) => ({
  slide_id: 's1',
  kind: 'background',
  label: '',
  props,
  media_id: media,
  media_name: media ? 'Placeholder picture.png' : null,
  media_kind: media ? 'image' : null,
  media_missing: media ? 0 : null,
});

describe('a video input as a slide’s background cue', () => {
  it('is read from its settings by name; a cue whose file is gone stays left out', () => {
    expect(cueFromRow(row('{"input":"Input 1"}'))).toEqual({
      kind: 'background',
      label: '',
      name: 'Input 1',
      missing: false,
      unplayable: null,
      background: { kind: 'input', name: 'Input 1' },
    });
    // A picture's file removed for good (its cue's file now none): nothing to put up, as before.
    expect(cueFromRow(row('{"media":"image","fit":"fill"}'))).toBeNull();
    for (const bad of ['{"input":""}', '{"input":"   "}', '{"input":7}', 'not json'])
      expect(cueFromRow(row(bad)), bad).toBeNull();
    // A cue with a file is that file's, whatever else its settings hold.
    const withFile = cueFromRow(row('{"media":"image","input":"Input 1"}', 'pic'));
    expect(withFile?.kind === 'background' ? withFile.background : null).toMatchObject({
      kind: 'media',
      mediaId: 'pic',
    });
    const cue = (kind: EditCue['kind'], mediaId: string | null, props: string): EditCue => ({
      id: 'c',
      kind,
      label: '',
      mediaId,
      props,
    });
    expect(cueInputName(cue('background', null, '{"input":" Input 1 "}'))).toBe('Input 1');
    expect(cueInputName(cue('background', 'pic', '{"input":"Input 1"}'))).toBeNull();
    expect(cueInputName(cue('audio', null, '{"input":"Input 1"}'))).toBeNull();
  });

  it('is saved from the slide editor, read back for it, and played as the slide’s background', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder',
      groups: [{ name: 'Verse', slides: [{ elements: [] }, { elements: [] }] }],
    });
    const rows = repo.content(id);
    if (!rows) throw new Error('no content');
    const { doc } = editDocOf(rows, 'Placeholder');
    const group = doc.groups[0];
    const [first, second] = group?.slides ?? [];
    if (!group || !first || !second) throw new Error('no slides');
    const input: EditCue = {
      id: 'cue-1',
      kind: 'background',
      label: '',
      mediaId: null,
      props: '{"input":"Input 1"}',
    };
    const edited = editDocSchema.parse({
      ...doc,
      groups: [{ ...group, slides: [{ ...first, cues: [input] }, second] }],
    });
    repo.setContent(applySlideEdit(rows, edited));
    const back = repo.content(id);
    if (!back) throw new Error('no content');
    expect(editDocOf(back, 'Placeholder').doc.groups[0]?.slides[0]?.cues).toEqual([
      { ...input, id: expect.any(String) as string },
    ]);
    const expected = {
      kind: 'background',
      label: '',
      name: 'Input 1',
      missing: false,
      unplayable: null,
      background: { kind: 'input', name: 'Input 1' },
    };
    expect(repo.get(id)?.groups[0]?.slides[0]?.cues).toEqual([expected]);
    expect(new DbSlideSource(repo).order(id)?.slides[0]?.cues).toEqual([expected]);
    db.close();
  });

  it('a save naming an input carries a name a video input can have, on a cue with no file', () => {
    const doc = (props: string, mediaId: string | null = null) => ({
      presentationId: 'p',
      name: 'Placeholder',
      width: 1920,
      height: 1080,
      transition: null,
      loop: false,
      groups: [
        {
          id: 'g',
          name: '',
          color: null,
          slides: [
            {
              id: 's',
              label: '',
              notes: '',
              background: null,
              darken: null,
              enabled: true,
              transition: null,
              autoAdvanceMs: null,
              macroId: null,
              elements: [],
              cues: [{ id: 'c', kind: 'background', label: '', mediaId, props }],
            },
          ],
        },
      ],
    });
    expect(editDocSchema.safeParse(doc('{"input":"Input 1"}')).success).toBe(true);
    // A cue whose file was removed for good (no input named) is kept as it was, as before.
    expect(editDocSchema.safeParse(doc('{"media":"image"}')).success).toBe(true);
    for (const bad of ['{"input":""}', '{"input":7}', `{"input":"${'x'.repeat(61)}"}`])
      expect(editDocSchema.safeParse(doc(bad)).success, bad).toBe(false);
    expect(editDocSchema.safeParse(doc('{"input":"Input 1"}', 'pic')).success).toBe(false);
  });
});
