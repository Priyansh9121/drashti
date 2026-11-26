import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf, type TestPdfPage } from '../../src/main/import/testing/make-pdf';
import type { NewItem } from '../../src/shared/playlists';
import { importAndGetIds, type PageGlobals } from './helpers';

/*
 * What a Pro Mode phone may still do (alpha.23, QA23-PHONE-1, the owner's "Only PPT and PDF"): put up a PowerPoint or a
 * PDF from a playlist, step inside it with Next and Back (Next stops at its last slide, never a video or the playlist's
 * next item) and clear its slide (the owner's Q7). What it may not do is refused (phone-refuses.ts). Generated pages
 * and placeholder words only.
 */

/** Beside NETWORK_ENV: a PDF comes in as pictures of its pages, nothing on this computer asked to convert it. */
export const PDF_ENV = { DRASHTI_TEST_NO_CONVERTER: '1' };

/** Three placeholder pages, the first two with a comment (a PDF's notes). */
export const THREE_PAGES: readonly TestPdfPage[] = [
  { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder deck page one' },
  { width: 960, height: 540, color: [127, 29, 29], text: 'Placeholder deck page two' },
  { width: 960, height: 540, color: [20, 83, 45], text: 'Placeholder deck page three' },
];

/** A placeholder PDF of these pages imported (a phone's deck: a presentation of its pages); its id. */
export async function placeholderPdf(
  win: Page,
  name: string,
  pages: readonly TestPdfPage[] = THREE_PAGES,
): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-pro-phone-')), `${name}.pdf`);
  writeFileSync(file, makeTestPdf(pages));
  const [id = ''] = await importAndGetIds(win, [file]);
  expect(id, `the placeholder PDF ${name} came in`).not.toBe('');
  return id;
}

/** A playlist made in the window with these rows, in order: its id and its rows' ids. */
export function playlistOf(
  win: Page,
  name: string,
  rows: NewItem[],
): Promise<{ playlistId: string; rows: string[] }> {
  return win.evaluate(
    async ({ name, rows }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const playlistId = made.ids[0] ?? '';
      const added = await d.playlists.addItems(playlistId, null, rows);
      if (!added.ok) throw new Error(added.message);
      return { playlistId, rows: (await d.playlists.items(playlistId)).map((item) => item.id) };
    },
    { name, rows },
  );
}

/**
 * A request from a paired phone's own page, with the token it keeps (src/renderer/src/web/device.ts), as its taps send
 * it: the status and the answer.
 */
export function phoneAsks(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      let token = '';
      try {
        token =
          (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { token?: string }).token ?? '';
      } catch {
        // Nothing kept: asked without a token (and refused as unpaired).
      }
      const response = await fetch(path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        // Not JSON.
      }
      return { status: response.status, json };
    },
    { method, path, body },
  );
}

/** Where the show is, as the engine says: the live presentation, its slide and its click. */
export async function liveNow(
  win: Page,
): Promise<{ presentationId: string | null; slideIndex: number | null; step: number | null }> {
  const { state } = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
  return {
    presentationId: state.live.presentationId,
    slideIndex: state.layers.slide?.slideIndex ?? null,
    step: state.layers.slide?.step ?? null,
  };
}

/**
 * Until the phone's own live picture draws the slide live now: its next tap then carries the show's latest revision
 * (a Next with an older one does nothing, Sessions 31–36, TST-11).
 */
export async function phoneShowsLive(page: Page, win: Page): Promise<void> {
  const slideId = await win.evaluate(
    async () =>
      (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide?.slide.id ?? null,
  );
  expect(slideId, 'a slide is live').not.toBeNull();
  await expect(page.getByTestId('remote-live').locator(`[data-slide="${slideId ?? ''}"]`)).toBeVisible();
}
