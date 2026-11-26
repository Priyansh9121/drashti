import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/chat';
import { CHAT_OPERATOR_ID, CHAT_OPERATOR_NAME } from '../../../shared/chat';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import {
  arrivals,
  CHAT_POP_CHARS,
  CHAT_POP_FADE_MS,
  CHAT_POP_MS,
  type ChatPop,
  popAfter,
  popChangesAt,
  popPhase,
  popText,
  popWords,
} from './chat-pop';
import { ChatPopView } from './ChatPop';

/*
 * The chat's popup in the operator window (alpha.24, QA24-CHATPOP-1; the owner: "if a chat comes, it should pop up in
 * drashti app in desktop, that there is a chat from this person saying this"): which messages pop up (others', new
 * since the window last heard; never the operator's own, never what was there as the window opened), a newer one
 * replacing it with "and N more", its 10 s and its fade (none with reduced motion), the message cut to 2 lines, and
 * its markup: a polite status a screen reader hears, nothing the keyboard lands on, blanked in Report a Problem's
 * picture. Placeholder names and words only.
 */

const from = (id: string, name: string) => ({ id, name });
const A = from('phone-a', 'Placeholder Sender');
const B = from('phone-b', 'Placeholder Other');
const ME = from(CHAT_OPERATOR_ID, CHAT_OPERATOR_NAME);

let n = 0;
const message = (who: { id: string; name: string }, text: string): ChatMessage => {
  n += 1;
  return { id: `m${String(n)}`, at: '2026-11-27T10:00:00.000Z', from: who, text };
};

const T0 = 1_000_000;

describe('which messages pop up', () => {
  it('none from the first view: what was in the chat as the window opened is no news', () => {
    expect(
      arrivals(
        null,
        [message(A, 'Placeholder old one'), message(B, 'Placeholder old two')],
        CHAT_OPERATOR_ID,
      ),
    ).toEqual([]);
  });

  it('others’ new messages, oldest first; the operator’s own never', () => {
    const old = message(A, 'Placeholder old');
    const mine = message(ME, 'Placeholder from the operator');
    const one = message(A, 'Placeholder new one');
    const two = message(B, 'Placeholder new two');
    expect(arrivals([old], [old, one, mine, two], CHAT_OPERATOR_ID)).toEqual([one, two]);
    expect(arrivals([old], [old, mine], CHAT_OPERATOR_ID)).toEqual([]);
  });

  it('none from the same messages again, from Clear chat, or from the day’s oldest dropping off the front', () => {
    const one = message(A, 'Placeholder one');
    const two = message(B, 'Placeholder two');
    const three = message(A, 'Placeholder three');
    expect(arrivals([one, two], [one, two], CHAT_OPERATOR_ID)).toEqual([]);
    expect(arrivals([one, two], [], CHAT_OPERATOR_ID)).toEqual([]);
    // The day's 300 kept: the oldest goes as a new one comes; only the new one pops up.
    expect(arrivals([one, two], [two, three], CHAT_OPERATOR_ID)).toEqual([three]);
  });
});

describe('a newer message replaces it, and while several come it says how many more', () => {
  it('the first: no more, up from now', () => {
    const one = message(A, 'Placeholder one');
    expect(popAfter(null, [one], T0, false)).toEqual({ message: one, more: 0, at: T0 });
  });

  it('a newer one while it is up replaces it, counting the one it replaced; again, two more', () => {
    const one = message(A, 'Placeholder one');
    const two = message(B, 'Placeholder two');
    const three = message(A, 'Placeholder three');
    const first = popAfter(null, [one], T0, false);
    const second = popAfter(first, [two], T0 + 3000, false);
    expect(second).toEqual({ message: two, more: 1, at: T0 + 3000 });
    expect(popAfter(second, [three], T0 + 4000, false)).toEqual({ message: three, more: 2, at: T0 + 4000 });
  });

  it('several in one change: the newest shows, the others counted', () => {
    const one = message(A, 'Placeholder one');
    const two = message(B, 'Placeholder two');
    const three = message(A, 'Placeholder three');
    expect(popAfter(null, [one, two, three], T0, false)).toEqual({ message: three, more: 2, at: T0 });
  });

  it('one coming as it fades still counts the one it replaces; once it has gone, the count starts again', () => {
    const one = message(A, 'Placeholder one');
    const two = message(B, 'Placeholder two');
    const first = popAfter(null, [one], T0, false);
    expect(popAfter(first, [two], T0 + CHAT_POP_MS + 10, false)?.more).toBe(1);
    expect(popAfter(first, [two], T0 + CHAT_POP_MS + CHAT_POP_FADE_MS, false)?.more).toBe(0);
    // With reduced motion there is no fade: gone at 10 s.
    expect(popAfter(first, [two], T0 + CHAT_POP_MS, true)?.more).toBe(0);
  });

  it('nothing new: the popup as it was', () => {
    const first = popAfter(null, [message(A, 'Placeholder one')], T0, false);
    expect(popAfter(first, [], T0 + 1000, false)).toBe(first);
    expect(popAfter(null, [], T0, false)).toBeNull();
  });
});

describe('it stays about 10 s, then fades (no fade with reduced motion)', () => {
  const pop: ChatPop = { message: message(A, 'Placeholder words'), more: 0, at: T0 };

  it('up for 10 s, fading for a moment after, then gone', () => {
    expect(CHAT_POP_MS).toBe(10_000);
    expect(popPhase(pop, T0, false)).toBe('up');
    expect(popPhase(pop, T0 + CHAT_POP_MS - 1, false)).toBe('up');
    expect(popPhase(pop, T0 + CHAT_POP_MS, false)).toBe('leaving');
    expect(popPhase(pop, T0 + CHAT_POP_MS + CHAT_POP_FADE_MS - 1, false)).toBe('leaving');
    expect(popPhase(pop, T0 + CHAT_POP_MS + CHAT_POP_FADE_MS, false)).toBe('gone');
    expect(popPhase(null, T0, false)).toBe('gone');
    expect(CHAT_POP_FADE_MS).toBeGreaterThan(0);
    expect(CHAT_POP_FADE_MS).toBeLessThanOrEqual(500);
  });

  it('with reduced motion (or interface motion Off): up for 10 s, then gone at once', () => {
    expect(popPhase(pop, T0 + CHAT_POP_MS - 1, true)).toBe('up');
    expect(popPhase(pop, T0 + CHAT_POP_MS, true)).toBe('gone');
  });

  it('when it next changes, for the window’s one timer', () => {
    expect(popChangesAt(pop, T0, false)).toBe(T0 + CHAT_POP_MS);
    expect(popChangesAt(pop, T0 + CHAT_POP_MS, false)).toBe(T0 + CHAT_POP_MS + CHAT_POP_FADE_MS);
    expect(popChangesAt(pop, T0 + CHAT_POP_MS + CHAT_POP_FADE_MS, false)).toBeNull();
    expect(popChangesAt(pop, T0 + 2000, true)).toBe(T0 + CHAT_POP_MS);
    expect(popChangesAt(pop, T0 + CHAT_POP_MS, true)).toBeNull();
    expect(popChangesAt(null, T0, false)).toBeNull();
  });
});

describe('its words: “Chat from <name>: <message>”, the message cut to 2 lines and “…”', () => {
  it('who and what, and “and N more” only when more came', () => {
    const one: ChatPop = { message: message(A, 'Placeholder hello'), more: 0, at: T0 };
    expect(popWords(one)).toEqual({
      from: 'Chat from Placeholder Sender:',
      text: 'Placeholder hello',
      more: null,
    });
    expect(popWords({ ...one, more: 1 }).more).toBe('and 1 more');
    expect(popWords({ ...one, more: 3 }).more).toBe('and 3 more');
  });

  it('two lines kept whole; a third cut, with “…”', () => {
    expect(popText('Placeholder line one\nPlaceholder line two')).toBe(
      'Placeholder line one\nPlaceholder line two',
    );
    expect(popText('Placeholder line one\nPlaceholder line two\nPlaceholder line three')).toBe(
      'Placeholder line one\nPlaceholder line two…',
    );
  });

  it('a long one cut to what two lines hold, with “…”, never inside a letter or an emoji', () => {
    const long = 'Placeholder words '.repeat(30);
    const cut = popText(long);
    expect(cut.length).toBeLessThanOrEqual(CHAT_POP_CHARS);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1).trimEnd())).toBe(true);
    // An emoji with its skin tone just at the cut: kept whole or left out whole.
    const emoji = '👍🏽';
    const at = `${'a'.repeat(CHAT_POP_CHARS - 2)}${emoji} more words`;
    const kept = popText(at).slice(0, -1);
    expect(kept === 'a'.repeat(CHAT_POP_CHARS - 2) || kept.endsWith(emoji)).toBe(true);
    expect(popText('Placeholder short')).toBe('Placeholder short');
  });
});

const render = (pop: ChatPop | null, { leaving = false, still = false } = {}) =>
  renderToStaticMarkup(
    createElement(ChatPopView, { pop, leaving, still, onOpen: () => undefined, onDismiss: () => undefined }),
  );

describe('its markup: heard politely, never on the keyboard’s path, blanked in Report a Problem’s picture', () => {
  const pop: ChatPop = { message: message(A, 'Placeholder <b>words</b> & 👍🏽'), more: 2, at: T0 };

  it('says who and what as text (never markup), and how many more', () => {
    const html = render(pop);
    expect(html).toContain('Chat from Placeholder Sender:');
    expect(html).toContain('Placeholder &lt;b&gt;words&lt;/b&gt; &amp; 👍🏽');
    expect(html).not.toContain('<b>');
    expect(html).toContain('and 2 more');
    expect(html).toContain('data-testid="chat-pop-dismiss"');
    expect(html).toContain('data-testid="chat-pop-open"');
  });

  it('a polite status, there before anything pops up (a screen reader hears it, the focus never moves)', () => {
    for (const html of [render(null), render(pop)]) {
      expect(html).toMatch(/role="status"/u);
      expect(html).toMatch(/aria-live="polite"/u);
      expect(html).not.toMatch(/aria-modal|autofocus|role="alert"|role="dialog"/iu);
    }
    expect(render(null)).not.toContain('Chat from');
  });

  it('nothing in it the keyboard lands on: its buttons are clicked, never tabbed to', () => {
    const html = render(pop);
    const buttons = html.match(/<button[^>]*>/gu) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toContain('tabindex="-1"');
    expect(html).not.toMatch(/tabindex="0"/u);
  });

  it('marked private, so Report a Problem’s picture of the window blanks it', () => {
    expect(render(pop)).toContain(`${REPORT_PRIVATE_ATTR}=""`);
  });

  it('fades as it leaves; with reduced motion it has no fade at all', () => {
    expect(render(pop, { leaving: true })).toMatch(/data-leaving="true"/u);
    expect(render(pop)).not.toMatch(/data-leaving/u);
    expect(render(pop)).toMatch(/transition-opacity/u);
    expect(render(pop, { still: true })).not.toMatch(/transition/u);
  });
});
