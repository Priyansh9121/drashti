import { describe, expect, it } from 'vitest';
import { trimmedTitle } from './trim';

/*
 * The name a row's trimmed video takes in Media (alpha.22), which its Trim dialog says before Save trimmed video
 * (the save-trim review's nit: the dialog cut any dot's ending off, so "Placeholder v1.2" read "Placeholder v1
 * trimmed", while the file made was "Placeholder v1.2 trimmed.mp4").
 */

describe('the name of a row’s trimmed video', () => {
  it('is the original’s, less a video’s extension, and “trimmed”', () => {
    expect(trimmedTitle('Placeholder two.mp4')).toBe('Placeholder two trimmed');
    expect(trimmedTitle('Placeholder clip.MOV')).toBe('Placeholder clip trimmed');
    expect(trimmedTitle('Placeholder overlay.webm')).toBe('Placeholder overlay trimmed');
    expect(trimmedTitle('Placeholder renamed')).toBe('Placeholder renamed trimmed');
  });

  it('keeps a dot that is part of the name', () => {
    expect(trimmedTitle('Placeholder v1.2')).toBe('Placeholder v1.2 trimmed');
    expect(trimmedTitle('Placeholder talk 1.5.mp4')).toBe('Placeholder talk 1.5 trimmed');
    expect(trimmedTitle('Placeholder notes.txt')).toBe('Placeholder notes.txt trimmed');
  });
});
