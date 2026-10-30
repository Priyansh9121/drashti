import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOWER_THIRD_FONT_CHOICES, STUDIO_FONT_FILES } from '../../shared/lower-third-fonts';

/*
 * The Lower Thirds studio's fonts (Session 55, Part 16): bundled with Drashti, never downloaded while it runs, each
 * file listed with where it came from and its sha256 beside its family's licence text (SIL OFL 1.1).
 */

const APP = join(__dirname, '..', '..', '..');

describe('the studio’s fonts', () => {
  it('every bundled file is in the repository, in studio-fonts.css, and in LICENSES/fonts/README.md with its source and sha256, with its family’s licence text', () => {
    const css = readFileSync(join(APP, 'src/renderer/src/render/studio-fonts.css'), 'utf8');
    const readme = readFileSync(join(APP, 'LICENSES/fonts/README.md'), 'utf8');
    const families = new Set(
      LOWER_THIRD_FONT_CHOICES.filter((f) => f.bundled === 'studio').flatMap((f) => f.families),
    );
    expect(new Set(STUDIO_FONT_FILES.map((f) => f.family))).toEqual(families);
    let bytes = 0;
    for (const f of STUDIO_FONT_FILES) {
      const path = join(APP, 'src/renderer/src/render/studio-fonts', f.file);
      expect(existsSync(path), f.file).toBe(true);
      const data = readFileSync(path);
      bytes += data.length;
      expect(data.subarray(0, 4).toString('latin1'), f.file).toBe('wOF2');
      const sha = createHash('sha256').update(data).digest('hex');
      expect(readme, f.file).toContain(sha);
      expect(readme, f.file).toContain(f.source);
      expect(css, f.file).toContain(`./studio-fonts/${f.file}`);
      expect(existsSync(join(APP, 'LICENSES/fonts', f.licence)), f.licence).toBe(true);
      expect(readFileSync(join(APP, 'LICENSES/fonts', f.licence), 'utf8'), f.licence).toMatch(
        /SIL OPEN FONT LICENSE Version 1\.1/iu,
      );
    }
    // Modest: under 2.5 MB in all.
    expect(bytes).toBeLessThan(2.5 * 1024 * 1024);
  });
});
