import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useMode } from '../operator/mode-store';
import { Panel } from '../ui/Panel';
import { setHelp } from './help-store';
import { useWhatIsThis } from './WhatIsThis';

/*
 * Help on demand (alpha.24, the owner's "too congusted all around"): while Help is off, no "?" is drawn at all (so
 * none is a Tab stop either), the panels' and the sections' under LIVE too (ui/Panel.tsx draws them through
 * useWhatIsThis); with Help on, each shows exactly as before, in Pro Mode only, as before. The status bar's switch says
 * which it is (help-switch.test.ts). Drawn to markup: unit tests run without a page.
 */

/** A heading's ? alone, as each place draws it. */
function Asker({ topic }: { topic: 'live' | 'statusbar' }) {
  return useWhatIsThis(topic).button;
}

const asker = (topic: 'live' | 'statusbar') => renderToStaticMarkup(createElement(Asker, { topic }));
const section = () =>
  renderToStaticMarkup(
    createElement(Panel, { title: 'Messages', help: 'messages', children: 'Placeholder' }),
  );

afterEach(() => {
  setHelp(false);
  useMode.setState({ mode: null });
});

describe('the ? with Help off and on', () => {
  it('draws no ? while Help is off, in Pro Mode, a panel’s heading included', () => {
    useMode.setState({ mode: 'pro' });
    setHelp(false);
    expect(asker('live')).toBe('');
    expect(asker('statusbar')).toBe('');
    expect(section()).not.toContain('data-what-is-this');
    expect(section()).toContain('Messages');
  });

  it('draws each ? as before with Help on', () => {
    useMode.setState({ mode: 'pro' });
    setHelp(true);
    expect(asker('live')).toContain('data-testid="what-is-this-live"');
    expect(asker('live')).toContain('aria-label="What is this? LIVE"');
    expect(asker('live')).toContain('aria-expanded="false"');
    expect(section()).toContain('data-testid="what-is-this-messages"');
  });

  it('draws none in Simple Mode, Help on or off, as before', () => {
    useMode.setState({ mode: 'simple' });
    for (const on of [false, true]) {
      setHelp(on);
      expect(asker('live')).toBe('');
      expect(section()).not.toContain('data-what-is-this');
    }
  });
});
