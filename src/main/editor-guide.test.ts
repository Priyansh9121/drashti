import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexGuide, passagesHolding, searchGuides } from '../shared/guides';
import { parseMarkdown, passagesOf } from '../shared/markdown';
import { PANEL_HELP } from '../shared/panel-help';

// These inspect the real bundled operator guide, not a fixture containing the new words.
// Install/run this file before applying the guide/help drafts to observe the missing guidance.
const source = readFileSync(join(process.cwd(), 'docs/operator-guide.md'), 'utf8');
const passages = passagesOf(parseMarkdown(source));
const indexed = indexGuide('operator', passages);
const section = '10. Editing slides in its own window';

function passage(start: string): string {
  const found = passagesHolding(passages, start);
  expect(found, `one usable passage for ${start}`).toHaveLength(1);
  expect(found[0]?.heading).toBe(false);
  return found[0]?.text ?? '';
}

describe('alpha.14 editor instructions in the bundled guide', () => {
  it('finds the authoring groups by their actual tools and opens practical passages', () => {
    for (const [query, lead] of [
      ['Find Replace master', 'Words: type and change the words.'],
      ['Crop picture', 'Crop only this slide.'],
      ['Ungroup table', 'Tables and icons.'],
      ['rulers grid guides', 'Place things with guides.'],
      ['Use master background', 'One shared master.'],
      ['Comes in', 'Motion timing.'],
      ['Slides across', 'Slides and notes.'],
    ] as const) {
      const hits = searchGuides([indexed], query)
        .filter((s) => s.section === section)
        .flatMap((s) => s.hits)
        .filter((p) => p.text.startsWith(lead));
      expect(hits, `${query} finds its operating instructions`).toHaveLength(1);
    }
  });

  it('explains the separate window, pending typing and the two histories', () => {
    const opening = passage('Edit slides opens its own window.');
    for (const group of ['Words', 'Insert', 'Arrange', 'Design', 'Motion', 'Slides']) {
      expect(opening).toContain(group);
    }
    expect(opening).toContain('operator window');
    const history = passage('Keep the last words, and save.');
    expect(history).toContain('unfinished typing');
    expect(history).toContain('one operator Undo');
    expect(history).toContain('image or video');
    expect(history).toContain('Save changes');
    expect(history).toContain('Keep editing');
    expect(history).toContain('Throw them away');
  });

  it('explains slide-only crop, master priority, resize fit and portable motion', () => {
    const crop = passage('Crop only this slide.');
    expect(crop).toContain('Whole picture');
    expect(crop).toContain('other uses');
    const master = passage('One shared master.');
    expect(master).toContain('Use master background');
    expect(master).toContain('own background');
    expect(master).toContain('takes priority');
    const size = passage('One size for the presentation.');
    expect(size).toContain('Fit and centre the existing content');
    expect(size).toContain('pixel positions');
    expect(size).toContain('imported deck');
    const motion = passage('Motion timing.');
    expect(motion).toContain('from the slide going up');
    expect(motion).toContain('one cycle');
    expect(motion).toContain('None');
    const outputs = passage('The same motion on every screen.');
    expect(outputs).toContain('full slide');
    expect(outputs).toContain('Camera');
    expect(outputs).toContain('same updated build');
  });

  it('keeps the Simple phone playlist, Play and photo destination exceptions explicit', () => {
    const phone = passage('The phone in Simple Mode.');
    expect(phone).toContain('own playlist');
    expect(phone).toContain('Rename');
    expect(phone).toContain('Remove');
    expect(phone).toContain('Undo');
    expect(phone).toContain('Play resumes');
    expect(phone).toContain('Pause and marker jumps');
    expect(phone).toContain('refused');
    // Question 5 (alpha.15): a phone's pictures go to the end of its playlist; its other files to Added from Phones.
    expect(phone).toContain('goes to the end of this playlist');
    expect(phone).toContain('Added from Phones');
    expect(source).not.toContain("and a phone's markers still jump");
    const presenter = passagesOf(
      parseMarkdown(readFileSync(join(process.cwd(), 'docs/presenter-guide.md'), 'utf8')),
    );
    const summary = presenter.find((p) => p.text.startsWith('What the page never does on its own:'));
    expect(summary, 'the presenter file-destination summary').toBeDefined();
    for (const detail of [
      'Add photos',
      'ordinary playlist open',
      'Pro Mode',
      'Simple Mode',
      'Added from Phones',
      'end of Simple Mode’s playlist',
    ]) {
      expect(summary?.text).toContain(detail);
    }
  });

  it('the Slides help card leads to the new window instructions, not a fallback heading', () => {
    const help = PANEL_HELP.slides;
    const found = passagesHolding(passages, help.guide);
    expect(help.text).toContain('own window');
    expect(found).toHaveLength(1);
    expect(found[0]?.heading).toBe(false);
    expect(found[0]?.section).toBe(section);
    expect(found[0]?.text).toContain('Edit slides opens its own window.');
  });
});
