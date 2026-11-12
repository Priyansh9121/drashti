import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../shared/engine/state';
import type { MediaElement, RenderSlide, SlideElement, TextElement } from '../../../shared/model';
import { hasPicture, lowerThirdOf, programPicture } from '../../../shared/program';
import { composeSlide } from '../../../shared/slide-design';
import type { EditSlide } from '../../../shared/slide-edit';
import { StageText } from './StageView';

const frame = { x: 12, y: 16, width: 300, height: 90 };
const visible: TextElement = {
  id: 'visible-placeholder',
  kind: 'text',
  frame,
  text: 'Placeholder visible words',
  lang: 'en',
  style: {
    fontFamily: null,
    fontSize: 22,
    fontWeight: 400,
    color: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
    shadow: false,
  },
};
const hiddenText: TextElement = {
  ...visible,
  id: 'hidden-placeholder',
  text: 'Placeholder hidden words',
  hidden: true,
};
const hiddenImage: MediaElement = {
  id: 'hidden-placeholder-picture',
  kind: 'image',
  frame,
  fit: 'fit',
  mediaId: 'placeholder-picture',
  hidden: true,
};

const slide = (elements: SlideElement[]): RenderSlide => ({
  id: 'placeholder-slide',
  width: 1280,
  height: 720,
  background: null,
  elements,
});

const resolved = (elements: SlideElement[]) => composeSlide(slide(elements), undefined, null);

function stateOf(slide: RenderSlide) {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: { presentationId: 'placeholder-deck', slideIndex: 0, slide, shownAt: 1, notes: '' },
    },
  };
}

describe('hidden objects at the shared screen boundary', () => {
  it('keeps only visible words in a key-and-fill lower third and the stream Camera layout', () => {
    const live = resolved([visible, hiddenText, hiddenImage]);
    expect(lowerThirdOf(live, null).lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual([
      visible.text,
    ]);
    const program = programPicture(stateOf(live), 'camera', null);
    expect(program).toMatchObject({ kind: 'camera', full: null });
    if (program.kind !== 'camera') throw new Error('The Camera layout is unavailable.');
    expect(program.lowerThird.map((line) => line.runs.map((run) => run.text).join(''))).toEqual([
      visible.text,
    ]);
  });

  it('keeps the camera on when the slide’s only picture is hidden', () => {
    const live = resolved([hiddenImage]);
    expect(hasPicture(live)).toBe(false);
    expect(programPicture(stateOf(live), 'camera', null)).toEqual({
      kind: 'camera',
      lowerThird: [],
      full: null,
      messages: false,
    });
  });

  it('renders only visible words on the stage', () => {
    const words = renderToStaticMarkup(createElement(StageText, { slide: resolved([hiddenText, visible]) }));
    expect(words).toContain(visible.text);
    expect(words).not.toContain(hiddenText.text);
  });

  it('filters hidden deck and master objects while leaving the editable model intact', () => {
    const baked = {
      ...slide([hiddenText, visible]),
      deck: { steps: [{ clipId: 'placeholder-still', clipMs: 0, lastId: 'placeholder-still' }], media: [] },
    };
    expect(composeSlide(baked, undefined, null).elements).toEqual([visible]);
    const masterObjects = [
      { ...hiddenImage, id: 'master-picture' },
      { ...hiddenText, id: 'master-words' },
    ];
    const master: EditSlide = {
      id: 'placeholder-master',
      label: '',
      notes: '',
      background: null,
      darken: null,
      enabled: true,
      transition: null,
      autoAdvanceMs: null,
      macroId: null,
      elements: masterObjects,
      cues: [],
    };
    const own = slide([visible, hiddenText]);
    const output = composeSlide(own, undefined, master);
    expect(output.elements).toEqual([visible]);
    expect(output.masterElementIds).toEqual([]);
    expect(own.elements).toEqual([visible, hiddenText]);
    expect(master.elements).toEqual(masterObjects);
  });
});
