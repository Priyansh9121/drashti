import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { endWindow, freshWindow } from './fresh-window';

/*
 * Every "What is this?" a target of at least 24 × 24 px (WCAG 2.5.8, the redesign's rule; qtargets, alpha.24): the
 * compact ?, the top bar's beside Stream, Phones and Announcements and the sabha flow's, was 20 × 20 px until then. It
 * is now 24 px square in the 20 px room it had (its margin gives 2 px back on each side), so no bar grows; and the top
 * bar keeps each ?'s room while Help is off, so Help turned on moves nothing there (help-targets.spec.ts measures both
 * in the window). Drawn to markup: unit tests run without a page.
 */

/** A ?'s class names, drawn with Help on in Pro Mode, compact or not. */
async function classesOf(compact: boolean): Promise<string[]> {
  freshWindow('pro', true);
  const { useWhatIsThis } = await import('./WhatIsThis');
  function Asker() {
    return useWhatIsThis('stream', { compact }).button;
  }
  const markup = renderToStaticMarkup(createElement(Asker));
  return /<button[^>]*class="([^"]*)"/u.exec(markup)?.[1]?.split(' ') ?? [];
}

/** The top bar as a new start of the window draws it in Pro Mode, Help on or off: each ?'s room, and what is in it. */
async function roomsOf(helpOn: boolean): Promise<{ classes: string[]; inside: string }[]> {
  freshWindow('pro', helpOn);
  const { Header } = await import('../operator/Header');
  const markup = renderToStaticMarkup(
    createElement(Header, { platform: 'win32', onOpenScreens: () => undefined }),
  );
  return [...markup.matchAll(/<span data-help-room="" class="([^"]*)">(.*?)<\/span>/gu)].map((m) => ({
    classes: (m[1] ?? '').split(' '),
    inside: m[2] ?? '',
  }));
}

afterEach(endWindow);

describe('every What is this? is a target of at least 24 × 24 px', () => {
  it('the compact ? (the top bar’s and the sabha flow’s) is 24 px square, in the 20 px room it had', async () => {
    const classes = await classesOf(true);
    expect(classes).toEqual(expect.arrayContaining(['h-6', 'w-6', '-m-0.5']));
    expect(classes).not.toContain('h-5');
    expect(classes).not.toContain('w-5');
  });

  it('every other ? is 24 px square, as before, taking its own room', async () => {
    const classes = await classesOf(false);
    expect(classes).toEqual(expect.arrayContaining(['h-6', 'w-6']));
    expect(classes).not.toContain('-m-0.5');
  });

  it('the top bar keeps the room of its ? beside Stream and Phones while Help is off (20 px square, empty), so Help on moves nothing there', async () => {
    const off = await roomsOf(false);
    expect(off).toHaveLength(2);
    for (const room of off) {
      expect(room.classes).toEqual(expect.arrayContaining(['flex', 'h-5', 'w-5', 'shrink-0']));
      expect(room.inside).toBe('');
    }
    const on = await roomsOf(true);
    expect(on.map((room) => /data-testid="([^"]*)"/u.exec(room.inside)?.[1])).toEqual([
      'what-is-this-stream',
      'what-is-this-phones',
    ]);
    expect(on.map((room) => room.classes)).toEqual(off.map((room) => room.classes));
  });
});
