import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { endWindow, freshWindow } from './fresh-window';

/*
 * Every "What is this?" a target of at least 24 × 24 px (WCAG 2.5.8, the redesign's rule; qtargets, alpha.24): the
 * compact ?, the top bar's beside Stream, Phones and Announcements and the sabha flow's, was 20 × 20 px until then. It
 * is now 24 px square in the 20 px room it had (its margin gives 2 px back on each side), so no bar grows
 * (help-targets.spec.ts measures it in the window). Drawn to markup: unit tests run without a page.
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

/** The top bar as a new start of the window draws it in Pro Mode, Help on or off: each ? in it and its class names. */
async function topBarAsks(helpOn: boolean): Promise<{ id: string; classes: string[] }[]> {
  freshWindow('pro', helpOn);
  const { Header } = await import('../operator/Header');
  const markup = renderToStaticMarkup(
    createElement(Header, { platform: 'win32', onOpenScreens: () => undefined }),
  );
  return [...markup.matchAll(/<button[^>]*data-testid="(what-is-this-[^"]*)"[^>]*class="([^"]*)"/gu)].map(
    (m) => ({
      id: m[1] ?? '',
      classes: (m[2] ?? '').split(' '),
    }),
  );
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

  it('the top bar’s ? beside Stream and Phones are the compact ones, drawn only while Help is on', async () => {
    expect(await topBarAsks(false)).toEqual([]);
    const on = await topBarAsks(true);
    expect(on.map((a) => a.id)).toEqual(['what-is-this-stream', 'what-is-this-phones']);
    for (const a of on) expect(a.classes, a.id).toEqual(expect.arrayContaining(['h-6', 'w-6', '-m-0.5']));
  });
});
