import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatList } from './ChatList';
import type { ChatRow } from './chat-view';

/*
 * The operator's chat list as it is drawn (QA23-CHAT-1): every word from a phone shown as words, never run as a page's
 * own (a message, a name or an emoji sequence that looks like HTML stays text), each message named for a screen
 * reader, and the operator's own on the right. Placeholder names and words only.
 */

const row = (over: Partial<ChatRow>): ChatRow => ({
  id: 'r1',
  mine: false,
  name: 'Placeholder A',
  sender: 'Placeholder A',
  time: '10:01',
  text: 'Placeholder words',
  ...over,
});

const render = (rows: ChatRow[]) => renderToStaticMarkup(createElement(ChatList, { rows }));

describe('the operator’s chat list', () => {
  it('shows a message and a name that look like HTML as words, never as the page’s own', () => {
    const html = render([
      row({
        name: '<img src=x onerror=alert(1)>',
        sender: '<img src=x onerror=alert(1)>',
        text: '<script>alert(1)</script><b>bold</b> &amp; 👍🏽',
      }),
    ]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;b&gt;bold&lt;/b&gt; &amp;amp; 👍🏽');
  });

  it('is a log a screen reader follows, each message saying who sent it and when', () => {
    const html = render([row({}), row({ id: 'r2', mine: true, name: null, sender: 'You', text: 'Reply' })]);
    expect(html).toMatch(/<ol[^>]*role="log"/);
    expect(html).toMatch(/<ol[^>]*aria-label="Chat messages"/);
    expect(html).toContain('Placeholder A, 10:01:');
    expect(html).toContain('You, 10:01:');
  });

  it('puts the operator’s own on the right and others’ on the left, the name above others’ only', () => {
    const html = render([row({}), row({ id: 'r2', mine: true, name: null, sender: 'You', text: 'Reply' })]);
    expect(html).toMatch(/data-testid="chat-message"[^>]*data-mine="false"/);
    expect(html).toMatch(/data-testid="chat-message"[^>]*data-mine="true"/);
    expect(html.match(/data-testid="chat-sender"/g)).toHaveLength(1);
  });

  it('wraps long words rather than cutting them short', () => {
    const html = render([row({ text: 'x'.repeat(500) })]);
    expect(html).toContain('x'.repeat(500));
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).not.toContain('truncate');
  });
});
