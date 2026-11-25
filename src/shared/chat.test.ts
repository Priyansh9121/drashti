import { describe, expect, it } from 'vitest';
import {
  CHAT_LINES_MAX,
  CHAT_NAME_MAX,
  CHAT_REFUSAL,
  CHAT_TEXT_MAX,
  chatDay,
  chatNameSchema,
  chatTextSchema,
  cleanChatText,
} from './chat';

/* The chat's words are plain text (alpha.23, QA23-CHAT-1): kept as typed, cleaned the same on a phone and the computer. */

const refusal = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : (r.error?.issues[0]?.message ?? '?');

describe('the chat’s plain text', () => {
  it('keeps what looks like HTML as the letters it is: never encoded, never stripped', () => {
    const typed = '<img src=x onerror="alert(1)"> & <b>bold</b> &amp; <script>x()</script>';
    expect(cleanChatText(typed)).toBe(typed);
    expect(chatTextSchema.parse(typed)).toBe(typed);
  });

  it('keeps emoji sequences, joiners and Gujarati and Hindi letters exactly as typed', () => {
    const typed = 'Jay 👨\u200D👩\u200D👧\u200D👦 👍🏽 🇮🇳 ક્ષ क्ष ર્\u200Dય';
    expect(cleanChatText(typed)).toBe(typed);
  });

  it('keeps line breaks as "\\n", with at most one blank line in a row, and trims the ends', () => {
    expect(cleanChatText('  one\r\ntwo\rthree\u2028four  \n\n\n\nfive\n\n')).toBe(
      'one\ntwo\nthree\nfour\n\nfive',
    );
    expect(cleanChatText('a\tb')).toBe('a b');
  });

  it('leaves out control characters and the direction marks that could turn the words around', () => {
    expect(cleanChatText('a\u0000b\u0007c\u007fd\u009be')).toBe('abcde');
    expect(cleanChatText('pay \u202Egnp.exe\u202C now \u2066x\u2069 \u200Fy')).toBe('pay gnp.exe now x y');
  });

  it('is empty when nothing visible is left', () => {
    expect(cleanChatText('  \n\u200B\u200D \u00AD\n ')).toBe('');
    expect(refusal(chatTextSchema.safeParse(' \n '))).toBe(CHAT_REFUSAL.empty);
  });

  it('takes up to CHAT_TEXT_MAX characters (as a text box counts them), and refuses more in plain words', () => {
    expect(chatTextSchema.safeParse('a'.repeat(CHAT_TEXT_MAX)).success).toBe(true);
    expect(refusal(chatTextSchema.safeParse('a'.repeat(CHAT_TEXT_MAX + 1)))).toBe(CHAT_REFUSAL.tooLong);
    // An emoji is two of them, as maxLength counts.
    expect(refusal(chatTextSchema.safeParse('😀'.repeat(CHAT_TEXT_MAX / 2 + 1)))).toBe(CHAT_REFUSAL.tooLong);
    // A huge body is refused before it is cleaned.
    expect(refusal(chatTextSchema.safeParse('a'.repeat(1_000_000)))).toBe(CHAT_REFUSAL.tooLong);
  });

  it('takes up to CHAT_LINES_MAX lines', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${String(i)}`).join('\n');
    expect(chatTextSchema.safeParse(lines(CHAT_LINES_MAX)).success).toBe(true);
    expect(refusal(chatTextSchema.safeParse(lines(CHAT_LINES_MAX + 1)))).toBe(CHAT_REFUSAL.tooManyLines);
  });

  it('refuses what is not words', () => {
    expect(chatTextSchema.safeParse(42).success).toBe(false);
    expect(chatTextSchema.safeParse(null).success).toBe(false);
  });
});

describe('a person’s name', () => {
  it('is cleaned as Rename… cleans a name: one line, no control or direction characters', () => {
    expect(chatNameSchema.parse('  Person\nOne\u202E ')).toBe('Person One');
    expect(chatNameSchema.parse('<b>Person</b>')).toBe('<b>Person</b>');
  });

  it('takes 1 to CHAT_NAME_MAX characters', () => {
    expect(chatNameSchema.safeParse('x'.repeat(CHAT_NAME_MAX)).success).toBe(true);
    expect(chatNameSchema.safeParse('x'.repeat(CHAT_NAME_MAX + 1)).success).toBe(false);
    expect(chatNameSchema.safeParse(' \u200B ').success).toBe(false);
  });
});

describe('the chat’s day', () => {
  it('is the date on the computer, in its time zone', () => {
    const at = Date.UTC(2026, 10, 25, 13, 30);
    expect(chatDay(at, 'UTC')).toBe('2026-11-25');
    // The same moment is already the next day in Sydney (UTC+11 in November).
    expect(chatDay(Date.UTC(2026, 10, 25, 13, 0), 'Australia/Sydney')).toBe('2026-11-26');
    expect(chatDay(Date.UTC(2026, 10, 25, 12, 59), 'Australia/Sydney')).toBe('2026-11-25');
  });
});
