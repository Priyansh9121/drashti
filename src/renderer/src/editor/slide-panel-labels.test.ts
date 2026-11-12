import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { newSlide, setBackgroundCue, setSoundCue } from './ops';
import { SlidePanel } from './SlidePanel';

function settingsFor(slide: EditSlide): string {
  const doc: EditDoc = {
    presentationId: 'presentation',
    name: 'Placeholder settings',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [{ id: 'group', name: 'Placeholder group', color: null, slides: [slide] }],
  };
  return renderToStaticMarkup(createElement(SlidePanel, { doc, slide }));
}

it('names the actions to choose, change and remove a slide’s background or sound', () => {
  const slide = newSlide(null);
  const empty = settingsFor(slide);
  expect(empty).toContain('>Choose background…</button>');
  expect(empty).toContain('>Choose sound…</button>');

  const filled = settingsFor(
    setSoundCue(setBackgroundCue(slide, { input: 'Placeholder input' }), {
      id: 'placeholder-sound',
      volume: 1,
      loop: false,
    }),
  );
  expect(filled).toContain('>Change background…</button>');
  expect(filled).toContain('>Remove background</button>');
  expect(filled).toContain('>Change sound…</button>');
  expect(filled).toContain('>Remove sound</button>');
});

it('names a group colour in words and describes what picking it changes', () => {
  const html = settingsFor(newSlide(null));
  expect(html).toMatch(
    /<button\b(?=[^>]*\baria-label="Purple")(?=[^>]*\btitle="Set the group colour to purple")[^>]*>/u,
  );
});
