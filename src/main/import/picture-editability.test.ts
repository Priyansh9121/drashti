import { describe, expect, it } from 'vitest';
import type { PictureSource } from '../../shared/pictures';
import { picturesIssues } from './pictures';

const expected: Record<PictureSource, string> = {
  pdf: 'Each of the 2 pages became a slide holding its picture for playback. Open Edit slides to change supported words, pictures and shapes in Drashti’s own copy. The original file is kept; some fonts or objects may look different.',
  pptx: 'Each of the 2 pages became a slide holding its picture for playback. Open Edit slides to change supported PowerPoint objects in Drashti’s own copy. The original file is kept; some fonts or objects may look different. Animations and builds show as each slide’s finished picture.',
  ppt: 'Each of the 2 pages became a slide holding its picture for playback. Open Edit slides and link a matching PDF reading copy to edit this deck’s own words and shapes. The original file is kept. Animations and builds show as each slide’s finished picture.',
  key: 'Each of the 2 pages became a slide holding its picture for playback. Open Edit slides and link a matching PDF reading copy to edit this deck’s own words and shapes. The original file is kept. Animations and builds show as each slide’s finished picture.',
};

describe('editable-document import explanations', () => {
  for (const source of ['pdf', 'pptx', 'ppt', 'key'] as const) {
    it(`explains the supported ${source} edit path and retained original without a blanket cannot-edit claim`, () => {
      const issues = picturesIssues({
        source,
        converter: null,
        pages: 2,
        total: 2,
        failed: [],
        withNotes: 0,
        animated: 0,
        notesUnmatched: false,
      });
      expect(issues.find((issue) => issue.code === 'pictures')?.message).toBe(expected[source]);
    });
  }
});
