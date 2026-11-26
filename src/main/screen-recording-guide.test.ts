import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, passagesOf } from '../shared/markdown';

/*
 * QA24-SCREENREC-1 (the owner's report): after an update, macOS listed Drashti turned on under Screen & System Audio
 * Recording, and still Show a Window said to allow it. Drashti is signed ad hoc, so macOS ties each permission to the
 * build that was allowed. The admin's guide says what to do then, where it explains the Mac's permissions (section 4),
 * for all three Drashti asks for: Screen Recording, the camera and the microphone. One short paragraph.
 */

const app = process.cwd();
const admin = passagesOf(parseMarkdown(readFileSync(join(app, 'docs', 'admin-guide.md'), 'utf8')));
/** Drashti's bundle id on a Mac, as the build gives it (electron-builder.yml), which tccutil names. */
const appId = /^appId: (\S+)$/mu.exec(readFileSync(join(app, 'electron-builder.yml'), 'utf8'))?.[1] ?? '';

describe('the admin’s guide on a Mac’s permissions after an update', () => {
  const said = admin.filter((p) => p.text.startsWith('Already on, but Drashti still asks'));

  it('says once, in section 4 beside Screen Recording, what to do when Drashti shows turned on and is still refused', () => {
    expect(said).toHaveLength(1);
    expect(said[0]?.section).toBe('4. Screens, the stage and sound');
    const before = admin[admin.findIndex((p) => p === said[0]) - 1];
    expect(before?.text).toMatch(
      /^Another app's window on the screens \(a Zoom meeting\): Screen Recording on a Mac\./u,
    );
  });

  it('names the three permissions, the Screen Recording list’s − and the box’s button, and one Terminal line for each', () => {
    const text = said[0]?.text ?? '';
    expect(text).toMatch(/\bMac\b/u);
    for (const name of ['Screen Recording', 'Camera', 'Microphone']) expect(text).toContain(name);
    // System Settings' remove button under the list is a minus sign (U+2212), as the app's box says it.
    expect(text).toContain('press −');
    expect(text).toContain('Open System Settings');
    // The Terminal line, by Drashti's own id, and the other two permissions' names in it.
    expect(appId).toBe('org.drashti.app');
    expect(text).toContain(`tccutil reset Camera ${appId}`);
    expect(text).toContain(
      '(or Microphone in place of Camera; ScreenCapture does the same for Screen Recording)',
    );
    // Short: one paragraph, not a section.
    expect(text.length).toBeLessThanOrEqual(900);
  });
});
