import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatOperatorView } from '../../../shared/chat';
import { CHAT_OPERATOR_ID, CHAT_OPERATOR_NAME } from '../../../shared/chat';
import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import { type ChatContentsProps, ChatContentsView } from './ChatSection';

/*
 * The operator's Chat section's open part (QA23-CHAT-1): the day's messages, the text box and the people, with Remove…
 * only in Pro Mode; and all of it inside the one box the page marks private, which Report a Problem's picture of the
 * window blanks (shared/report-private.ts, main/report/private-parts.ts). Placeholder names and words only.
 */

const VIEW: ChatOperatorView = {
  day: '2026-11-25',
  messages: [
    {
      id: 'm1',
      at: '2026-11-25T10:01:00.000Z',
      from: { id: 'phone-a', name: 'Placeholder Sender' },
      text: 'Placeholder secret words',
    },
    {
      id: 'm2',
      at: '2026-11-25T10:02:00.000Z',
      from: { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME },
      text: 'Placeholder reply words',
    },
  ],
  people: [
    { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME },
    { id: 'phone-a', name: 'Placeholder Sender' },
    { id: 'phone-b', name: 'Placeholder Member' },
  ],
  members: [
    { id: 'phone-a', name: 'Placeholder Sender', kind: 'chat', connected: true, named: true },
    { id: 'phone-b', name: 'Placeholder Member', kind: 'remote', connected: false, named: true },
  ],
  invite: null,
  reachable: true,
};

const render = (over: Partial<ChatContentsProps> = {}) =>
  renderToStaticMarkup(
    createElement(ChatContentsView, {
      view: VIEW,
      operateOnly: false,
      networkOn: true,
      error: null,
      draft: 'Placeholder draft',
      onDraft: () => undefined,
      peopleOpen: true,
      onPeopleOpen: () => undefined,
      ...over,
    }),
  );

describe('the Chat section’s open part', () => {
  it('shows the day’s messages, the people and the text box with the words not sent yet', () => {
    const html = render();
    expect(html).toContain('Placeholder secret words');
    expect(html).toContain('Placeholder reply words');
    expect(html).toContain('Placeholder Member');
    expect(html).toContain('Placeholder draft');
    expect(html).toContain('data-testid="chat-text-box"');
    expect(html.match(/data-testid="chat-remove-person"/g)).toHaveLength(2);
  });

  it('in Simple Mode reads and sends, and removes a chat phone only, never a Remote (core’s S5)', () => {
    const html = render({ operateOnly: true });
    expect(html).toContain('Placeholder secret words');
    expect(html).toContain('data-testid="chat-send"');
    // VIEW's members: one chat phone, one Remote.
    expect(html.match(/data-testid="chat-remove-person"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Remove Placeholder Sender from the chat"');
    expect(html).not.toContain('aria-label="Remove Placeholder Member from the chat"');
  });

  it('says while the Chat QR lets phones join, with Stop, in either mode, in a line that is always there', () => {
    const invite = {
      code: '000000',
      url: 'http://192.0.2.1:8080/chat#c=000000',
      expiresAt: Date.now() + 600_000,
    };
    for (const operateOnly of [false, true]) {
      const shown = render({ operateOnly, view: { ...VIEW, invite } });
      expect(shown).toContain('Phones can join by the Chat QR code');
      expect(shown).toContain('data-testid="chat-section-invite-end"');
    }
    const none = render();
    expect(none).toContain('data-testid="chat-invite-slot"');
    expect(none).not.toContain('data-testid="chat-section-invite-end"');
  });

  it('keeps every word and name of the chat inside the box Report a Problem’s picture blanks', () => {
    const html = render();
    // The open part is one box, marked private: nothing of it is outside it.
    expect(html.startsWith(`<div ${REPORT_PRIVATE_ATTR}=""`)).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html.match(new RegExp(`${REPORT_PRIVATE_ATTR}=`, 'gu'))).toHaveLength(1);
    // Simple Mode's too.
    expect(render({ operateOnly: true }).startsWith(`<div ${REPORT_PRIVATE_ATTR}=""`)).toBe(true);
  });

  it('keeps its messages in a box of one height, empty or full, and a slot for a refusal, so nothing under it moves as messages come (a22-review-chat O-S1)', () => {
    // An element's opening tag, by its test id (its class comes before the id in the markup).
    const tag = (html: string, id: string) =>
      new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`, 'u').exec(html)?.[0] ?? '';
    const box = (html: string) => tag(html, 'chat-messages-box');
    const empty = render({ view: { ...VIEW, messages: [] } });
    const full = render();
    expect(box(empty)).toContain('h-[clamp(10rem,30vh,20rem)]');
    expect(box(full)).toContain('h-[clamp(10rem,30vh,20rem)]');
    expect(full).not.toContain('max-h-[40vh]');
    // The refusal's line is there before any refusal, the same height with one.
    expect(tag(full, 'chat-problem')).toContain('min-h-4');
    expect(tag(render({ error: 'Placeholder refusal.' }), 'chat-problem')).toContain('min-h-4');
    // The people, open, in a box of their own height whoever joins.
    expect(tag(full, 'chat-people-list')).toContain('h-28');
  });

  it('lists a phone with no name yet, removable as anyone (core’s M3, a22-review-chat O-S3)', () => {
    const html = render({
      // Core's M3: its device's name, and named false.
      view: {
        ...VIEW,
        members: [{ id: 'phone-c', name: 'Chat 3', kind: 'chat', connected: true, named: false }],
      },
    });
    expect(html).toContain('Chat 3 (no name yet)');
    expect(html).toContain('data-testid="chat-remove-person"');
    expect(html).toContain('aria-label="Remove Chat 3 (no name yet) from the chat"');
    // No word says a phone is in the chat only once it has a name.
    expect(render({ view: { ...VIEW, members: [] } })).not.toContain('gives their name');
  });

  it('says plainly when phones cannot reach it, and how to let them', () => {
    const off = render({ view: { ...VIEW, reachable: false }, networkOn: false });
    expect(off).toContain('turn on Let paired phones and tablets connect');
    // Simple Mode does not turn the network on: it is only told.
    const simple = render({ view: { ...VIEW, reachable: false }, networkOn: false, operateOnly: true });
    expect(simple).toContain('Phones cannot reach the chat now.');
    expect(simple).not.toContain('turn on');
  });
});

describe('a popup opens Chat while its Simple Mode feature is off', () => {
  it('reads the messages but offers no composer whose send Main would refuse', () => {
    const html = render({ operateOnly: true, canSend: false });
    expect(html).toContain('Placeholder secret words');
    expect(html).toContain('To reply here, choose Chat in Pro Mode’s Simple Mode Features.');
    expect(html).not.toContain('data-testid="chat-composer"');
    expect(html).not.toContain('data-testid="chat-send"');
    // Existing Simple Mode rules for removing a chat-only phone stay as they are.
    expect(html.match(/data-testid="chat-remove-person"/g)).toHaveLength(1);
  });

  it('with Chat chosen, keeps the composer and sending as before', () => {
    const html = render({ operateOnly: true, canSend: true });
    expect(html).toContain('data-testid="chat-composer"');
    expect(html).toContain('data-testid="chat-send"');
    expect(html).not.toContain('To reply here, choose Chat');
  });
});
