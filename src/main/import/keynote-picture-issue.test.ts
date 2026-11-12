import { expect, it } from 'vitest';
import { picturesIssues } from './pictures';

it('opens the retained Keynote derivative directly in Edit slides', () => {
  const details = {
    source: 'key',
    converter: 'keynote',
    editableSource: 'pptx',
    pages: 1,
    total: 1,
    failed: [],
    withNotes: 0,
    animated: 0,
    notesUnmatched: false,
  } as const;
  const notice = picturesIssues(details).find((issue) => issue.code === 'pictures');
  expect(notice?.message).toContain('Open Edit slides to change Keynote’s words');
  expect(notice?.message).toContain('PowerPoint copy');
});
