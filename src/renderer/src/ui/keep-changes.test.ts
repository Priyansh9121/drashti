import { describe, expect, it } from 'vitest';
import { linesChanged, settingsChanged } from './KeepChanges';

// How much the ask-before-closing question says would be lost (Session 25). Placeholder words only.
describe('what closing would lose', () => {
  it('counts lines changed, added or taken out (the larger), not moved', () => {
    const before = 'Placeholder one\n\nPlaceholder two\n';
    expect(linesChanged(before, before)).toBe(0);
    expect(linesChanged(before, 'Placeholder one\n\nPlaceholder two, fixed\n')).toBe(1);
    expect(linesChanged(before, `${before}\nPlaceholder three\nPlaceholder four\n`)).toBe(3);
    expect(linesChanged(before, 'Placeholder two\n\nPlaceholder one\n')).toBe(0);
    expect(linesChanged(before, '')).toBe(3);
  });

  it('counts each setting changed once, however deep, and a changed list as one', () => {
    const theme = { name: 'Placeholder', langs: { gu: { size: 72, color: '#ffffff' } }, cues: [1, 2] };
    expect(settingsChanged(theme, theme)).toBe(0);
    expect(settingsChanged(theme, { ...theme, name: 'Other' })).toBe(1);
    expect(settingsChanged(theme, { ...theme, langs: { gu: { size: 80, color: '#000000' } } })).toBe(2);
    expect(settingsChanged(theme, { ...theme, cues: [2, 1] })).toBe(1);
    expect(settingsChanged(null, theme)).toBe(1);
  });
});
