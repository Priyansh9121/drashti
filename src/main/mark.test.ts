import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The mark in the window is the app's icon (Session 26g): ui/Mark.tsx draws build/icon.svg's tile,
 * flame, core and bowl with its colours, so the lamp in the header is the lamp on the Dock. Read
 * from the sources, so a change to either shows here.
 */

const root = join(__dirname, '..', '..');
const icon = readFileSync(join(root, 'build', 'icon.svg'), 'utf8');
const mark = readFileSync(join(root, 'src', 'renderer', 'src', 'ui', 'Mark.tsx'), 'utf8');

/** The `d` of each path in the icon, in order: the flame, its core, the bowl. */
const iconPaths = [...icon.matchAll(/<path\s+d="([^"]+)"/gu)].map((m) => m[1]?.replace(/\s+/gu, ' '));
const stops = (id: string) =>
  [
    ...(new RegExp(`id="${id}"[\\s\\S]*?</linearGradient>`, 'u').exec(icon)?.[0] ?? '').matchAll(
      /stop-color="(#[0-9a-f]{6})"/giu,
    ),
  ].map((m) => m[1]?.toLowerCase());

describe('the mark is the icon', () => {
  it('draws the icon’s flame, core and bowl', () => {
    expect(iconPaths).toHaveLength(3);
    const [flame, core, bowl] = iconPaths;
    expect(mark).toContain(`flame: '${flame ?? ''}'`);
    expect(mark).toContain(`core: '${core ?? ''}'`);
    expect(mark).toContain(`bowl: '${bowl ?? ''}'`);
  });

  it('on the icon’s tile', () => {
    const tile = /<rect id="tile" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="(\d+)"/u.exec(icon);
    expect(tile).not.toBeNull();
    const [, x, y, w, h, rx] = tile ?? [];
    expect(mark).toContain(
      `tile: { x: ${x ?? ''}, y: ${y ?? ''}, width: ${w ?? ''}, height: ${h ?? ''}, rx: ${rx ?? ''} }`,
    );
  });

  it('in the icon’s colours', () => {
    expect(mark).toContain(`tile: ['${stops('tile-fill').join("', '")}']`);
    expect(mark).toContain(`flame: ['${stops('flame').join("', '")}']`);
    expect(mark).toContain(`bowl: ['${stops('bowl').join("', '")}']`);
    const core = /fill="(#[0-9a-f]{6})"\/>\s*<path d="M262/u.exec(icon)?.[1];
    expect(mark).toContain(`core: '${core ?? 'missing'}'`);
    const edge = /stroke="(#[0-9a-f]{6})"/u.exec(icon)?.[1];
    expect(mark).toContain(`bowlEdge: '${edge ?? 'missing'}'`);
  });
});
