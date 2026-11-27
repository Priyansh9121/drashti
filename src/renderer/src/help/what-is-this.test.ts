import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { OperatorMode } from '../../../shared/mode';
import { endWindow, freshWindow } from './fresh-window';

/*
 * Help on demand (alpha.24, the owner's "too congusted all around"): while Help is off, no "?" is drawn at all (so
 * none is a Tab stop either), the panels' and the sections' under LIVE too (ui/Panel.tsx draws them through
 * useWhatIsThis); with Help on, each shows exactly as before, in Pro Mode only, as before. The status bar's switch says
 * which it is (help-switch.test.ts). Drawn to markup: unit tests run without a page.
 */

/** What a heading's ? and a panel with one draw, in a new start of the window in this mode, Help on or off. */
async function drawn(mode: OperatorMode, helpOn: boolean) {
  freshWindow(mode, helpOn);
  const { useWhatIsThis } = await import('./WhatIsThis');
  const { Panel } = await import('../ui/Panel');
  function Asker({ topic }: { topic: 'live' | 'statusbar' }) {
    return useWhatIsThis(topic).button;
  }
  return {
    asker: (topic: 'live' | 'statusbar') => renderToStaticMarkup(createElement(Asker, { topic })),
    section: renderToStaticMarkup(
      createElement(Panel, { title: 'Messages', help: 'messages', children: 'Placeholder' }),
    ),
  };
}

afterEach(endWindow);

describe('the ? with Help off and on', () => {
  it('draws no ? while Help is off, in Pro Mode, a panel’s heading included', async () => {
    const { asker, section } = await drawn('pro', false);
    expect(asker('live')).toBe('');
    expect(asker('statusbar')).toBe('');
    expect(section).not.toContain('data-what-is-this=');
    expect(section).not.toContain('<button type="button" aria-label="What is this?');
    expect(section).toContain('Messages');
  });

  it('holds the ?’s room in a panel’s heading while Help is off: an empty box of its size, no button, hidden from screen readers', async () => {
    const off = (await drawn('pro', false)).section;
    expect(off).toMatch(
      /<span aria-hidden="true" data-what-is-this-room="" class="inline-block shrink-0 h-6 w-6"><\/span>/u,
    );
    // With Help on, the ? itself in that place, and no empty box.
    const on = (await drawn('pro', true)).section;
    expect(on).toContain('data-testid="what-is-this-messages"');
    expect(on).not.toContain('data-what-is-this-room');
    // The heading's other ? (a place's own, not a panel's) holds no room.
    expect((await drawn('pro', false)).asker('live')).toBe('');
  });

  it('draws each ? as before with Help on', async () => {
    const { asker, section } = await drawn('pro', true);
    expect(asker('live')).toContain('data-testid="what-is-this-live"');
    expect(asker('live')).toContain('aria-label="What is this? LIVE"');
    expect(asker('live')).toContain('aria-expanded="false"');
    expect(section).toContain('data-testid="what-is-this-messages"');
  });

  it('draws none in Simple Mode, Help on or off, as before', async () => {
    for (const on of [false, true]) {
      const { asker, section } = await drawn('simple', on);
      expect(asker('live')).toBe('');
      // Neither a ? nor its room: Simple Mode has no ? of its own.
      expect(section).not.toContain('data-what-is-this');
    }
  });
});
