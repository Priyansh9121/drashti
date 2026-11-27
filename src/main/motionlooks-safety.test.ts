import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(?:ts|tsx|css)$/u.test(name) && !/\.test\./u.test(name) ? [path] : [];
  });
}

describe('the release lead’s interface capture prohibition', () => {
  it('contains no document view-transition API, snapshot name or snapshot CSS anywhere in production source', () => {
    const captures = sources(src).filter((path) =>
      /startViewTransition|view-transition-name|::view-transition/u.test(readFileSync(path, 'utf8')),
    );
    expect(captures.map((path) => relative(src, path).split('\\').join('/'))).toEqual([]);
  });

  it('keeps Calm press words fully opaque while its decorative edge answers', () => {
    const css = readFileSync(join(src, 'renderer/src/ui/motion.css'), 'utf8');
    const active =
      /:root\[data-opened\]\[data-chip='yes'\]\[data-interface-motion='calm'\][^{]*:active\s*\{([^}]*)\}/u.exec(
        css,
      )?.[1] ?? '';
    expect(active).toMatch(/opacity:\s*1\s*;/u);
    expect(active).toContain('box-shadow:');
  });

  it('keeps appearance/mode independent of the Help effect and has no snapshot/copy/GPU path in that effect', () => {
    for (const path of ['preload/index.ts', 'renderer/src/operator/mode-store.ts']) {
      const code = readFileSync(join(src, path), 'utf8');
      expect(code, path).not.toMatch(/interface-fade|softCrossFades|crossFades|flushSync|pendingMode/u);
    }
    const help = readFileSync(join(src, 'shared/interface-fade.ts'), 'utf8');
    expect(help).not.toMatch(
      /cloneNode|createElement|drawImage|capturePage|toDataURL|view-transition|navigator\.gpu/u,
    );
    expect(help).not.toMatch(/'look'|'mode'/u);
  });
});
