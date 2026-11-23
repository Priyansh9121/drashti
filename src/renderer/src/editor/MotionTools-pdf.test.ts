import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EditDoc } from '../../../shared/slide-edit';
import { MotionTools } from './MotionTools';
import { useEditor } from './editor-store';
import { newSlide } from './ops';
import type * as EditorStore from './editor-store';

// Read the current real editor state in server rendering, where Zustand normally uses its initial snapshot.
vi.mock('./editor-store', async (importOriginal) => {
  const actual = await importOriginal<typeof EditorStore>();
  return {
    ...actual,
    useEditor: Object.assign(
      (selector: (state: ReturnType<typeof actual.useEditor.getState>) => unknown) =>
        selector(actual.useEditor.getState()),
      actual.useEditor,
    ),
  };
});

function fixture(clickOrder?: number): EditDoc {
  return {
    presentationId: 'placeholder-pdf',
    name: 'Placeholder',
    width: 480,
    height: 320,
    transition: null,
    loop: false,
    groups: [
      {
        id: 'group',
        name: '',
        color: null,
        slides: [
          {
            ...newSlide(null),
            id: 'page',
            documentPage: { ext: 'pdf', sha256: 'a'.repeat(64), page: 0, width: 480, height: 320 },
            elements: [
              {
                id: 'mark',
                kind: 'shape',
                frame: { x: 10, y: 20, width: 80, height: 40 },
                fill: '#f4c542',
                cornerRadius: 0,
                opacity: 0.32,
                pdfMark: { tool: 'highlight', clickOrder },
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() =>
  useEditor.setState({
    doc: fixture(),
    slideId: 'page',
    selection: ['mark'],
    previewAt: null,
    saving: false,
    loading: false,
    pdfDrawing: false,
    sourceConversion: null,
  }),
);

it('keeps the existing PDF timed-motion tools beside the opt-in click control', () => {
  const html = renderToStaticMarkup(createElement(MotionTools));
  expect(html).toContain('Comes in on click');
  for (const phase of ['in', 'emphasis', 'out']) {
    const control = new RegExp(`<select[^>]*data-testid="motion-element-${phase}"[^>]*>`, 'u').exec(
      html,
    )?.[0];
    expect(control).toBeDefined();
    expect(control).not.toContain('disabled=""');
  }
});

it('disables timed-motion editing while the selected mark is built by Next', () => {
  useEditor.setState({ doc: fixture(1) });
  const html = renderToStaticMarkup(createElement(MotionTools));
  for (const phase of ['in', 'emphasis', 'out']) {
    const control = new RegExp(`<select[^>]*data-testid="motion-element-${phase}"[^>]*>`, 'u').exec(
      html,
    )?.[0];
    expect(control).toBeDefined();
    expect(control).toContain('disabled=""');
  }
});
