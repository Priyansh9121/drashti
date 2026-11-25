import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CHAT_INVITE_TTL_MS } from '../../../shared/chat';
import { ChatInviteView } from './ChatInvite';

/*
 * The Phones panel's Chat QR (QA23-CHAT-1): a button to show it, then the code with how long it still works and Stop;
 * nothing to show while the network is off. The code here is a placeholder, never a real one.
 */

const NOW = 1_000_000;
const INVITE = {
  code: '000000',
  url: 'http://192.0.2.1:8080/pair#c=000000',
  expiresAt: NOW + CHAT_INVITE_TTL_MS,
};

const render = (over: Partial<Parameters<typeof ChatInviteView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ChatInviteView, {
      invite: null,
      listening: true,
      now: NOW,
      problem: null,
      onShow: () => undefined,
      onEnd: () => undefined,
      ...over,
    }),
  );

describe('the Chat QR in Phones', () => {
  it('offers to show it while the network is on, saying who is in the chat already', () => {
    const html = render();
    expect(html).toContain('data-testid="chat-invite-show"');
    expect(html).toContain('Show the Chat QR code');
    expect(html).toContain('Everyone paired as a Remote or for Announcements is in the chat already.');
    expect(html).not.toContain('data-testid="qr-code"');
  });

  it('shows the code with how long it still works, and Stop', () => {
    const html = render({ invite: INVITE });
    expect(html).toContain('data-testid="qr-code"');
    expect(html).toContain('aria-label="QR code that joins the chat"');
    expect(html).toContain('Works for 10:00 more');
    expect(html).toContain('data-testid="chat-invite-end"');
    expect(render({ invite: INVITE, now: NOW + CHAT_INVITE_TTL_MS - 61_000 })).toContain('Works for 1:01 more');
  });

  it('offers it again once its time is up', () => {
    const html = render({ invite: INVITE, now: NOW + CHAT_INVITE_TTL_MS });
    expect(html).not.toContain('data-testid="qr-code"');
    expect(html).toContain('data-testid="chat-invite-show"');
  });

  it('says to turn the network on first, and shows a refusal in plain words', () => {
    expect(render({ listening: false, invite: INVITE })).toContain(
      'Turn the network on to show the Chat QR code.',
    );
    expect(render({ listening: false, invite: INVITE })).not.toContain('data-testid="qr-code"');
    expect(render({ problem: 'Placeholder refusal.' })).toMatch(/role="alert"[^>]*>Placeholder refusal\./);
  });
});
