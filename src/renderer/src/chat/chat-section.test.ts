import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatOperatorView } from '../../../shared/chat';
import { CHAT_OPERATOR_ID, CHAT_OPERATOR_NAME } from '../../../shared/chat';
import { type ChatContentsProps, ChatContentsView } from './ChatSection';

/*
 * The operator's Chat section's open part (QA23-CHAT-1): while Report a Problem takes the window's picture (the hold),
 * it draws none of the chat's words or names, a message half typed included, and says why; otherwise the day's
 * messages, the text box and the people, with Remove… only in Pro Mode. Placeholder names and words only.
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
    { id: 'phone-a', name: 'Placeholder Sender', kind: 'chat', connected: true },
    { id: 'phone-b', name: 'Placeholder Member', kind: 'remote', connected: false },
  ],
  invite: null,
  reachable: true,
};

const render = (over: Partial<ChatContentsProps> = {}) =>
  renderToStaticMarkup(
    createElement(ChatContentsView, {
      view: VIEW,
      held: false,
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

  it('in Simple Mode reads and sends, and removes no one', () => {
    const html = render({ operateOnly: true });
    expect(html).toContain('Placeholder secret words');
    expect(html).toContain('data-testid="chat-send"');
    expect(html).not.toContain('data-testid="chat-remove-person"');
  });

  it('draws none of the chat’s words or names while Report a Problem takes the picture, and says why', () => {
    const html = render({ held: true });
    for (const words of [
      'Placeholder secret words',
      'Placeholder reply words',
      'Placeholder Sender',
      'Placeholder Member',
      'Placeholder draft',
    ])
      expect(html, words).not.toContain(words);
    expect(html).toContain('data-testid="chat-held"');
    expect(html).toContain('The chat’s words and names are left out of this picture.');
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
