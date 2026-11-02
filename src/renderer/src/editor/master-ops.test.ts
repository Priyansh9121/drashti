import { describe, expect, it } from 'vitest';
import type { EditDoc } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import type { TextElement } from '../../../shared/model';
import { nfcEditDoc } from '../../../shared/nfc';
import { findMatches, replaceMatches } from './find-replace';
import { findSlide, mapElements, newSlide } from './ops';

const text: TextElement = {
  id: 'placeholder-master-text',
  kind: 'text',
  text: 'Placeholder shared heading',
  lang: null,
  frame: { x: 100, y: 100, width: 800, height: 200 },
  style: {
    fontFamily: null,
    fontSize: 48,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.35,
    shadow: false,
  },
};
const fixture = () => ({
  presentationId: 'placeholder-presentation',
  name: 'Placeholder master',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  master: { ...newSlide(null), id: 'placeholder-master', elements: [text] },
  groups: [
    {
      id: 'placeholder-group',
      name: 'Placeholder group',
      color: null,
      slides: [{ ...newSlide(null), id: 'placeholder-slide' }],
    },
  ],
});

describe('one master on the ordinary editor canvas', () => {
  it('is editable without becoming a playable slide in the strip', () => {
    const doc = fixture();
    expect(slidesOf(doc).map((s) => s.id)).toEqual(['placeholder-slide']);
    expect(findSlide(doc, doc.master.id)).toEqual(doc.master);
    const next = mapElements(doc, doc.master.id, [text.id], (el) => ({
      ...el,
      frame: { ...el.frame, x: 300 },
    }));
    expect(findSlide(next, doc.master.id)?.elements[0]?.frame.x).toBe(300);
    expect(findSlide(doc, doc.master.id)?.elements[0]?.frame.x).toBe(100);
  });
  it('includes the master once in Find and Replace, without copying its words into every slide', () => {
    const doc = fixture();
    const matches = findMatches(doc, 'shared', { matchCase: false, wholeWords: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ slideId: doc.master.id, elementId: text.id });
    const next = replaceMatches(doc, matches, 'common');
    expect(findSlide(next, doc.master.id)?.elements[0]).toMatchObject({ text: 'Placeholder common heading' });
    expect(slidesOf(next)[0]?.elements).toEqual([]);
  });
  it('normalizes words typed on the master at the same boundary as ordinary slides', () => {
    const doc = fixture();
    doc.master.elements = [{ ...text, text: '\u0958' }];
    const normalized: EditDoc = nfcEditDoc(doc);
    expect(normalized).toHaveProperty('master.elements.0.text', '\u0915\u093c');
  });
});
