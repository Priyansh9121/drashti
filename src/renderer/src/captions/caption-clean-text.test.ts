import { describe, expect, it } from 'vitest';
import {
  captionCleanCountText,
  captionCleanListText,
  captionCleanOwnText,
  hiddenWordName,
} from './caption-clean-text';

/* The words-left-out dialogs' sentences (alpha.24, QA24-CAPCLEAN-1): counts only, never a word. */

describe('the words-left-out sentences', () => {
  it('say how many words captions left out since they were turned on', () => {
    expect(captionCleanCountText(0)).toBe('No words left out since captions were turned on.');
    expect(captionCleanCountText(1)).toBe('1 word left out since captions were turned on.');
    expect(captionCleanCountText(12)).toBe('12 words left out since captions were turned on.');
  });

  it('say how many words of the admin’s own a language has', () => {
    expect(captionCleanListText('Gujarati', 0)).toBe('No Gujarati words of your own yet.');
    expect(captionCleanListText('Hindi', 1)).toBe('1 Hindi word of your own.');
    expect(captionCleanListText('English', 3)).toBe('3 English words of your own.');
  });

  it('say how many words Drashti’s own list has, never which', () => {
    expect(captionCleanOwnText({ gu: 20, hi: 30, sa: 0, en: 40 })).toBe(
      'Drashti’s own list has 90 words in Gujarati, Hindi and English, and every caption is checked against all of them, whatever its language.',
    );
  });

  it('name a word kept hidden by its place in the list', () => {
    expect(hiddenWordName(0)).toBe('Hidden word 1');
    expect(hiddenWordName(4)).toBe('Hidden word 5');
  });
});
