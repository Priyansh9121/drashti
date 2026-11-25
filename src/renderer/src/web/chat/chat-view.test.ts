import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../shared/chat';
import { ChatBannerView, ChatList, ChatNameForm, MIC_HINT } from './ChatView';

const ME = 'phone-me';
const AT = Date.UTC(2026, 10, 25, 8, 5);
const message = (id: string, from: { id: string; name: string }, text: string, at = AT): ChatMessage => ({
  id,
  at: new Date(at).toISOString(),
  from,
  text,
});
const clock = { locale: 'en-GB', timeZone: 'UTC' };
const list = (messages: ChatMessage[]) =>
  renderToStaticMarkup(createElement(ChatList, { messages, me: ME, clock }));

describe('the chat list, WhatsApp-style', () => {
  const other = { id: 'phone-other', name: 'Placeholder Volunteer' };
  const mine = { id: ME, name: 'Placeholder Me' };
  const html = list([
    message('1', other, 'Placeholder first message'),
    message('2', mine, 'Placeholder my answer 🙏', AT + 60_000),
    message('3', { id: 'operator', name: 'Placeholder Operator' }, 'Placeholder newest'),
  ]);

  it('shows the sender’s name above each message from someone else, and none above this phone’s own', () => {
    expect(html.match(/data-testid="chat-from"/gu)).toHaveLength(2);
    expect(html).toContain('Placeholder Volunteer');
    expect(html).toContain('Placeholder Operator');
    expect(html).not.toContain('Placeholder Me</');
  });

  it('puts this phone’s own messages on the right, others’ on the left', () => {
    const sides = [...html.matchAll(/data-testid="chat-message" data-own="(true|false)"/gu)].map((m) => m[1]);
    expect(sides).toEqual(['false', 'true', 'false']);
  });

  it('shows each message’s time in Drashti’s way of writing it, text and emoji, newest at the bottom', () => {
    expect(html).toContain('08:05');
    expect(html).toContain('08:06');
    expect(html).toContain('🙏');
    expect(html.indexOf('Placeholder first message')).toBeLessThan(html.indexOf('Placeholder newest'));
  });

  it('says plainly when there are no messages yet', () => {
    expect(list([])).toContain('No messages yet today.');
  });
});

describe('every word in the chat is shown as words, never run as HTML', () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const html = list([message('1', { id: 'x', name: `<b onclick="alert(3)">Placeholder</b>` }, hostile)]);

  it('escapes a message’s words and a sender’s name', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;b onclick=&quot;alert(3)&quot;&gt;Placeholder&lt;/b&gt;');
  });

  it('escapes them in the banner too', () => {
    const banner = renderToStaticMarkup(
      createElement(ChatBannerView, {
        message: message('1', { id: 'x', name: '<i>Placeholder</i>' }, hostile),
        onOpen: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    expect(banner).not.toContain('<img');
    expect(banner).not.toContain('<i>');
    expect(banner).toContain('&lt;i&gt;Placeholder&lt;/i&gt;');
  });

  it('the chat’s code never writes HTML, asks for the microphone or uses the browser’s speech service', () => {
    const files = import.meta.glob<string>(['./*.ts', './*.tsx', '!./*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(files)).toContain('./ChatView.tsx');
    for (const [file, code] of Object.entries(files)) {
      for (const banned of [
        'dangerouslySetInnerHTML',
        'innerHTML',
        'outerHTML',
        'insertAdjacentHTML',
        'getUserMedia',
        'SpeechRecognition',
        'speechSynthesis',
      ])
        expect(code, `${file} uses ${banned}`).not.toContain(banned);
    }
  });
});

describe('asking the name once, and the microphone hint', () => {
  it('asks for the name with a text box of 16 px or more (a phone zooms in on a smaller one)', () => {
    const html = renderToStaticMarkup(
      createElement(ChatNameForm, { onName: () => null, problem: null, initial: '' }),
    );
    expect(html).toContain('data-testid="chat-name"');
    expect(html).toContain('Your name in the chat');
    expect(html).toMatch(/data-testid="chat-name"[^>]*class="[^"]*text-lg/u);
  });

  it('tells the person to use the keyboard’s own microphone to speak', () => {
    expect(MIC_HINT).toBe('Tap 🎤 on your keyboard to speak');
  });
});
