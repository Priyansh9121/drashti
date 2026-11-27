import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/* A source guard for the cascade contract; Chromium computes the actual kept dialog outline in focus-review.spec.ts,
 * including reduced motion and forced colours. A base-layer offset cannot override utilities' focus:outline-none. */
it('gives kept keyboard focus a full inset outline outside the layers that ordinary focus utilities override', () => {
  const css = readFileSync(join(__dirname, '../renderer/src/styles/app.css'), 'utf8');
  const kept = /^\[data-focus-kept\]:focus-visible\s*\{([^}]+)\}/mu.exec(css)?.[1] ?? '';
  expect(kept, 'an unlayered kept-place rule must beat the dialog’s focus:outline-none utility').toMatch(
    /outline:\s*2px solid var\(--color-accent\);/u,
  );
  expect(kept, 'the full ring stays inside the kept place').toMatch(/outline-offset:\s*-2px;/u);
  expect(kept).not.toMatch(/forced-color-adjust:\s*none/u);
});
