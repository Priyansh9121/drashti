import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Layout contracts checked without starting the app. Windows exercises the actual glyphs and controls.
const operator = join(__dirname, '../renderer/src/operator');
const source = readFileSync(join(operator, 'StatusBar.tsx'), 'utf8');
const css = readFileSync(join(operator, 'status-bar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
const declarations = (selector: string) => {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
  return Object.fromEntries(
    blocks
      .filter((m) => m[1]?.trim() === selector)
      .flatMap((m) => (m[2] ?? '').split(';'))
      .filter((s) => s.includes(':'))
      .map((s) => {
        const colon = s.indexOf(':');
        return [s.slice(0, colon).trim(), s.slice(colon + 1).trim()];
      }),
  );
};

describe('the one-row status budget', () => {
  it('fits the reviewed 1024 px combined case with the full two-kind silence notice', () => {
    // The review's conservative DOM/font ledger: 991.51 with Audio muted (110.36 px), plus the omitted news gap.
    const other = 991.51 - 110.36 + 8;
    const mute = declarations("footer[aria-label='Status'] [data-testid='sound-muted-status']");
    const width = Number.parseFloat(mute['max-width'] ?? 'Infinity');
    expect(other + width).toBeLessThanOrEqual(1024);
    // All original words must remain readable within the SAME 28 px footer, without reducing their 12 px type.
    expect(Number.parseFloat(mute['line-height'] ?? '16') * 2 + 2).toBeLessThanOrEqual(27);
    expect(mute['white-space']).toBe('normal');
    expect(mute['overflow']).not.toBe('hidden');
    expect(mute['font-size']).toBeUndefined();
  });

  it('reserves a bounded calendar room before a date exists, on either side of 1536 px', () => {
    const room = declarations("footer[aria-label='Status'] .status-calendar-slot");
    expect(room['width']).toBeDefined();
    // A room must be present before the conditional button, rather than a narrow-only placeholder.
    const today = source.slice(
      source.indexOf('function TodayStatus'),
      source.indexOf('function NodeWarnings'),
    );
    expect(today).not.toMatch(/if\s*\(!day\)/u);
    expect(today).not.toContain('max-[1536px]:block');
    expect(today.indexOf('status-calendar-slot')).toBeLessThan(today.indexOf('data-testid="today-calendar"'));
    expect(today).not.toContain('max-[1536px]:sr-only');
  });

  it('chooses the 24 px calendar from measured words, retaining a separate steady room', () => {
    const today = source.slice(
      source.indexOf('function TodayStatus'),
      source.indexOf('function NodeWarnings'),
    );
    expect(today).toContain('useStatusPriority(');
    expect(today).toContain('ref={slotRef}');
    expect(today).toContain('ref={wordsRef}');
    const compact = declarations("footer[aria-label='Status'] .status-calendar[data-compact='true']");
    expect(compact['width']).toBe('24px');
    expect(compact['padding-inline']).toBe('0');
    expect(today).toContain('aria-label={words}');
    expect(today).toContain('title={`${words}');
  });
});
