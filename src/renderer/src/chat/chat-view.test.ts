import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chat-standin';
import { CHAT_TEXT_MAX, OPERATOR_ID } from './chat-standin';
import { chatRows, composerCheck, unreadCount, unreadWords } from './chat-view';

/*
 * The operator's Chat section (QA23-CHAT-1), its words and counts worked out apart from the window: the day's messages
 * as WhatsApp shows a group (the sender's name above theirs, the operator's own on the right), how many came in since
 * the operator last looked, and what the text box says before Send. Placeholder names and words only.
 */

const at = (minute: number) => `2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`;
const msg = (id: string, from: string, name: string, text: string, minute: number): ChatMessage => ({
  id,
  at: at(minute),
  from: { id: from, name },
  text,
});
const time = (iso: string) => iso.slice(11, 16);

const DAY: ChatMessage[] = [
  msg('m1', 'phone-a', 'Placeholder A', 'First words', 1),
  msg('m2', 'phone-a', 'Placeholder A', 'More words', 2),
  msg('m3', OPERATOR_ID, 'Operator', 'Placeholder reply', 3),
  msg('m4', 'phone-b', 'Placeholder B', 'Other words', 4),
  msg('m5', 'phone-a', 'Placeholder A', 'Back again', 5),
];

describe('the chat’s rows', () => {
  it('puts the operator’s own on the right with no name above, and the time of each', () => {
    const rows = chatRows(DAY, OPERATOR_ID, time);
    const own = rows.find((r) => r.id === 'm3');
    expect(own).toMatchObject({ mine: true, name: null, sender: 'You', time: '10:03', text: 'Placeholder reply' });
    expect(rows.filter((r) => r.mine).map((r) => r.id)).toEqual(['m3']);
  });

  it('names the sender above the first of each run of their messages, as a WhatsApp group does', () => {
    const rows = chatRows(DAY, OPERATOR_ID, time);
    expect(rows.map((r) => r.name)).toEqual(['Placeholder A', null, null, 'Placeholder B', 'Placeholder A']);
    // A screen reader hears who sent each one, named above it or not.
    expect(rows.map((r) => r.sender)).toEqual([
      'Placeholder A',
      'Placeholder A',
      'You',
      'Placeholder B',
      'Placeholder A',
    ]);
  });

  it('keeps the order they came in, newest last', () => {
    expect(chatRows(DAY, OPERATOR_ID, time).map((r) => r.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('tells two people with the same name apart by who sent it, not by the name', () => {
    const twins = [
      msg('t1', 'phone-a', 'Placeholder', 'One', 1),
      msg('t2', 'phone-b', 'Placeholder', 'Two', 2),
    ];
    expect(chatRows(twins, OPERATOR_ID, time).map((r) => r.name)).toEqual(['Placeholder', 'Placeholder']);
  });
});

describe('the unread count', () => {
  it('counts what others sent after the last one the operator saw, never the operator’s own', () => {
    expect(unreadCount(DAY, 'm2', OPERATOR_ID)).toBe(2);
    expect(unreadCount(DAY, 'm4', OPERATOR_ID)).toBe(1);
    expect(unreadCount(DAY, 'm5', OPERATOR_ID)).toBe(0);
  });

  it('counts every one from others when none was seen, or the one seen is gone (Clear chat, a new day)', () => {
    expect(unreadCount(DAY, null, OPERATOR_ID)).toBe(4);
    expect(unreadCount(DAY, 'gone', OPERATOR_ID)).toBe(4);
    expect(unreadCount([], 'm5', OPERATOR_ID)).toBe(0);
  });

  it('says the count in words for a screen reader, and keeps the badge small', () => {
    expect(unreadWords(1)).toEqual({ badge: '1', words: '1 new message' });
    expect(unreadWords(3)).toEqual({ badge: '3', words: '3 new messages' });
    expect(unreadWords(150)).toEqual({ badge: '99+', words: '150 new messages' });
    expect(unreadWords(0)).toBeNull();
  });
});

describe('the text box before Send', () => {
  it('cannot send nothing, or only spaces', () => {
    expect(composerCheck('')).toEqual({ canSend: false, line: null });
    expect(composerCheck('   ')).toEqual({ canSend: false, line: null });
  });

  it('sends words within the limit, saying how many are left only near it', () => {
    expect(composerCheck('Placeholder words')).toEqual({ canSend: true, line: null });
    expect(composerCheck('a'.repeat(CHAT_TEXT_MAX - 20))).toEqual({ canSend: true, line: '20 letters left' });
    expect(composerCheck('a'.repeat(CHAT_TEXT_MAX - 1))).toEqual({ canSend: true, line: '1 letter left' });
    expect(composerCheck('a'.repeat(CHAT_TEXT_MAX))).toEqual({ canSend: true, line: '0 letters left' });
  });

  it('refuses words past the limit in plain words, and keeps them all in the box (nothing cut short)', () => {
    expect(composerCheck('a'.repeat(CHAT_TEXT_MAX + 1))).toEqual({
      canSend: false,
      line: `1 letter too many: ${String(CHAT_TEXT_MAX)} at most`,
    });
    expect(composerCheck('a'.repeat(CHAT_TEXT_MAX + 7))).toEqual({
      canSend: false,
      line: `7 letters too many: ${String(CHAT_TEXT_MAX)} at most`,
    });
  });
});
