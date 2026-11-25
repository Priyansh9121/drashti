import { describe, expect, it } from 'vitest';
import { CHAT_NAME_MAX, CHAT_TEXT_MAX, type ChatMessage } from './chat-contract';
import { chatNameProblem, chatTextProblem, newFromOthers, tidyChatName, unreadStill } from './chat-words';

const message = (id: string, from: string, text = `Placeholder message ${id}`): ChatMessage => ({
  id,
  at: 1_764_000_000_000,
  from: { id: from, name: `Placeholder ${from}` },
  text,
});

describe('a person’s name in the chat, asked once on the phone', () => {
  it('is tidied: spaces at its ends and runs of spaces, tabs or new lines become one space', () => {
    expect(tidyChatName('  Placeholder \t Volunteer\n ')).toBe('Placeholder Volunteer');
  });
  it('must be given, in plain words', () => {
    expect(chatNameProblem('   ')).toBe('Type your name first.');
    expect(chatNameProblem('Placeholder Volunteer')).toBeNull();
  });
  it('is at most the contract’s length, and says so', () => {
    expect(chatNameProblem('a'.repeat(CHAT_NAME_MAX))).toBeNull();
    expect(chatNameProblem('a'.repeat(CHAT_NAME_MAX + 1))).toBe(
      `A name is ${String(CHAT_NAME_MAX)} letters at most.`,
    );
  });
});

describe('a message’s words', () => {
  it('must have some words', () => {
    expect(chatTextProblem('  \n ')).toBe('Type a message first.');
  });
  it('are at most 500 characters, counted as the text box counts them; emoji are words too', () => {
    expect(CHAT_TEXT_MAX).toBe(500);
    expect(chatTextProblem('a'.repeat(CHAT_TEXT_MAX))).toBeNull();
    expect(chatTextProblem('🙏 Placeholder thank you 🎉')).toBeNull();
    expect(chatTextProblem('a'.repeat(CHAT_TEXT_MAX + 1))).toBe(
      `A message is ${String(CHAT_TEXT_MAX)} characters at most (this one is ${String(CHAT_TEXT_MAX + 1)}).`,
    );
  });
});

describe('which messages are new from someone else', () => {
  it('counts none on the first read: the history is not news', () => {
    expect(newFromOthers(null, [message('1', 'other')], 'me')).toEqual([]);
  });
  it('is what arrived since the last read, from anyone but this phone, oldest first', () => {
    const before = [message('1', 'other')];
    const after = [...before, message('2', 'me'), message('3', 'other'), message('4', 'operator')];
    expect(newFromOthers(before, after, 'me').map((m) => m.id)).toEqual(['3', '4']);
  });
  it('is everything from others after the chat was cleared or the day changed (new ids)', () => {
    const before = [message('1', 'other')];
    expect(newFromOthers(before, [message('9', 'other')], 'me').map((m) => m.id)).toEqual(['9']);
  });
  it('without knowing who this phone is, counts nothing as its own', () => {
    expect(newFromOthers([], [message('1', 'me')], null).map((m) => m.id)).toEqual(['1']);
  });
});

describe('the unread messages', () => {
  it('keep only those still in the chat (Clear chat takes them away)', () => {
    expect(unreadStill(['1', '3'], [message('3', 'other'), message('4', 'other')])).toEqual(['3']);
    expect(unreadStill(['1'], [])).toEqual([]);
  });
});
