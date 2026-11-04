import { expect, test } from '@playwright/test';
import { editorGroup, sizeSlideEditor } from './helpers';
import { openGeneratedPdf } from './pdf-tools-fixtures';

for (const windowSize of [
  { width: 1280, height: 720 },
  { width: 1024, height: 645 },
]) {
  test(`a shared master fits every PDF paper at window width ${windowSize.width}`, async () => {
    const s = await openGeneratedPdf();
    try {
      await sizeSlideEditor(s.app, s.ed, windowSize);
      await editorGroup(s.ed, 'Design');
      await s.editor.getByTestId('design-master').click();
      await expect(s.editor.getByTestId('editor-master-banner')).toBeVisible();
      await editorGroup(s.ed, 'Insert');
      await s.editor.getByTestId('add-shape').click();
      await s.ed.getByRole('menuitem', { name: 'Arrow', exact: true }).click();
      const source = await s.editor.getByTestId('editor-slide').evaluate((node) => {
        const element = node.querySelector<HTMLElement>('[data-element]');
        const parent = node.parentElement;
        if (!element || !parent) throw new Error('Missing master shape or canvas.');
        return {
          width: parseFloat(parent.style.width),
          height: parseFloat(parent.style.height),
          frame: {
            x: parseFloat(element.style.left),
            y: parseFloat(element.style.top),
            width: parseFloat(element.style.width),
            height: parseFloat(element.style.height),
          },
        };
      });
      await s.editor.getByTestId('master-done').click();
      for (const [index, paper] of [
        { width: 480, height: 320 },
        { width: 320, height: 480 },
        { width: 481.25, height: 319.5 },
      ].entries()) {
        await s.editor.getByTestId('editor-slide-thumb').nth(index).click();
        const master = s.editor.getByTestId('editor-slide').locator('[data-master-content] [data-element]');
        await expect(master).toHaveCount(1);
        const actual = await master.evaluate((node) => {
          if (!(node instanceof HTMLElement || node instanceof SVGElement))
            throw new Error('Missing master shape.');
          const pixels = (property: string) => {
            const value = node.computedStyleMap().get(property);
            if (!(value instanceof CSSUnitValue) || value.unit !== 'px')
              throw new Error(`Missing numeric master ${property}.`);
            return value.value;
          };
          return { x: pixels('left'), y: pixels('top'), width: pixels('width'), height: pixels('height') };
        });
        const scale = Math.min(paper.width / source.width, paper.height / source.height);
        const expected = {
          x: source.frame.x * scale + (paper.width - source.width * scale) / 2,
          y: source.frame.y * scale + (paper.height - source.height * scale) / 2,
          width: source.frame.width * scale,
          height: source.frame.height * scale,
        };
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(actual[key], `paper ${index} master ${key}`).toBeCloseTo(expected[key], 6);
      }
      s.unchanged();
    } finally {
      await s.app.close();
      s.unchanged();
    }
  });
}
