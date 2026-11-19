import { describe, expect, it } from 'vitest';
import { fileName, withoutEnding } from './drop-names';

describe('the drop window’s names (Session 60, x36)', () => {
  it('takes a file’s name from a Mac’s path and from a Windows path', () => {
    expect(fileName('/Users/placeholder/Movies/Placeholder clip.mp4')).toBe('Placeholder clip.mp4');
    expect(fileName('C:\\Users\\placeholder\\Videos\\Placeholder clip.mov')).toBe('Placeholder clip.mov');
    expect(fileName('Placeholder clip.webm')).toBe('Placeholder clip.webm');
  });

  it('names the new playlist after the file, without its ending', () => {
    expect(withoutEnding('Placeholder clip.mp4')).toBe('Placeholder clip');
    expect(withoutEnding('Placeholder katha.part 2.mov')).toBe('Placeholder katha.part 2');
    expect(withoutEnding('પ્લેસહોલ્ડર ક્ષણ.mp4')).toBe('પ્લેસહોલ્ડર ક્ષણ');
    expect(withoutEnding('Placeholder words')).toBe('Placeholder words');
    expect(withoutEnding('.hidden')).toBe('.hidden');
    expect(withoutEnding('Placeholder.')).toBe('Placeholder.');
  });
});
