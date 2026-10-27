import { expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds } from './helpers';

/*
 * What the time bar's specs share (Session 54, time-bar.spec.ts and time-bar-everywhere.spec.ts): the engine's timing
 * of each thing playing, how far a window's copy of a file is from where the engine's clock says, waiting until every
 * copy is in step (or held where a pause put it), and the rows of the bar under LIVE. Placeholder media only.
 */

export async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/** How a file plays, as the engine has it: from when, looping or not, between which points, from which move. */
export interface Timing {
  startedAt: number;
  loop: boolean;
  clip?: { startMs: number; endMs: number | null };
  seek?: { at: number; toMs: number; paused?: boolean };
}

export const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

export const dispatch = (win: Page, command: Record<string, unknown>) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** The background video's timing. */
export async function backgroundTiming(win: Page): Promise<Timing> {
  const bg = (await snapshot(win)).layers.background;
  if (bg?.kind !== 'media') throw new Error('no background video');
  return { startedAt: bg.startedAt, loop: bg.loop, clip: bg.clip, seek: bg.seek };
}

/** A video on the slide up's timing, by its file. */
export async function slideTiming(win: Page, mediaId: string, loop: boolean): Promise<Timing> {
  const slide = (await snapshot(win)).layers.slide;
  if (!slide) throw new Error('no slide');
  return { startedAt: slide.shownAt, loop, clip: slide.clips?.[mediaId], seek: slide.seeks?.[mediaId] };
}

/** The picture-in-picture box's video's timing (it always goes round). */
export async function boxTiming(win: Page, mediaId: string): Promise<Timing> {
  const box = (await snapshot(win)).layers.pip;
  if (!box) throw new Error('no box');
  return { startedAt: box.shownAt, loop: true, clip: box.clips?.[mediaId], seek: box.seeks?.[mediaId] };
}

/** A prop's video's timing, by the prop and the file (a prop's own videos have no bar: the engine moves them). */
export async function propTiming(win: Page, propId: string, mediaId: string, loop: boolean): Promise<Timing> {
  const prop = (await snapshot(win)).layers.props.find((p) => p.id === propId);
  if (!prop?.shownAt) throw new Error('no prop');
  return { startedAt: prop.shownAt, loop, clip: prop.clips?.[mediaId], seek: prop.seeks?.[mediaId] };
}

/** The sound's timing. */
export async function soundTiming(win: Page): Promise<Timing> {
  const a = (await snapshot(win)).layers.audio;
  if (!a) throw new Error('no sound');
  return { startedAt: a.startedAt, loop: a.loop, clip: a.clip, seek: a.seek };
}

/**
 * How far a window's copy is from where the clock says (seconds, + ahead), the median of a few samples, as every
 * screen works it out (shared/media.ts playbackPosition); null while it is not there, has no length yet or is not
 * playing.
 */
export function offsetOf(page: Page, selector: string, t: Timing): Promise<number | null> {
  return page.evaluate(
    async ({ selector, t }) => {
      const samples: number[] = [];
      for (let i = 0; i < 7; i++) {
        const v = document.querySelector<HTMLMediaElement>(selector);
        if (!v || !Number.isFinite(v.duration) || v.paused) return null;
        const start = Math.min(v.duration, (t.clip?.startMs ?? 0) / 1000);
        const end = Math.min(v.duration, (t.clip?.endMs ?? v.duration * 1000) / 1000);
        const span = end - start;
        const from = t.seek ? Math.min(end, Math.max(start, t.seek.toMs / 1000)) : start;
        const elapsed = (Date.now() - (t.seek ? t.seek.at : t.startedAt)) / 1000;
        const expected =
          t.loop && span > 0 ? start + ((from - start + elapsed) % span) : Math.min(from + elapsed, end);
        const off = v.currentTime - expected;
        samples.push(t.loop && span > 0 ? ((((off + span / 2) % span) + span) % span) - span / 2 : off);
        // eslint-disable-next-line no-restricted-syntax -- in the page: samples 60 ms apart while it plays
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      samples.sort((a, b) => a - b);
      return samples[3] ?? null;
    },
    { selector, t },
  );
}

export const FRAME = 1 / 30;
/** The sound near the screens (as markers.spec.ts allows a jump: within what broadcasters accept). */
export const SOUND_MARGIN = 0.15;

export interface Copy {
  name: string;
  page: Page;
  selector: string;
  /** The audio player's copy: near the screens rather than within two frames of them. */
  sound?: boolean;
}

/** Wait until every copy is near the clock, the screens within two frames of each other, the sound near them. */
export async function inStep(copies: Copy[], timing: () => Promise<Timing>, what: string): Promise<void> {
  const end = Date.now() + 15_000;
  const seen: string[] = [];
  for (;;) {
    const t = await timing();
    const offsets = await Promise.all(copies.map((c) => offsetOf(c.page, c.selector, t)));
    seen.push(
      offsets.map((o, i) => `${copies[i]?.name ?? ''} ${o === null ? 'none' : o.toFixed(3)}`).join(', '),
    );
    // Every copy there and near the clock; then the screens' offsets and the sound's.
    const near = offsets.every((o) => o !== null && Math.abs(o) < 0.25);
    const screens = offsets.filter((o, i): o is number => o !== null && copies[i]?.sound !== true);
    const heard = offsets.filter((o, i): o is number => o !== null && copies[i]?.sound === true);
    const together = screens.length === 0 || Math.max(...screens) - Math.min(...screens) < 2 * FRAME;
    const middle = screens.length > 0 ? screens.reduce((x, y) => x + y, 0) / screens.length : null;
    const sound = middle === null || heard.every((o) => Math.abs(o - middle) < SOUND_MARGIN);
    if (near && together && sound) return;
    if (Date.now() > end) throw new Error(`${what}: not in step after 15 s. Each look:\n${seen.join('\n')}`);
  }
}

/** Every copy paused where the engine's pause put it, within a frame. */
export async function heldAt(copies: Copy[], seconds: number, what: string): Promise<void> {
  for (const c of copies)
    await expect
      .poll(
        () =>
          c.page.evaluate(
            ({ selector, seconds }) => {
              const v = document.querySelector<HTMLMediaElement>(selector);
              return v !== null && v.paused && Math.abs(v.currentTime - seconds) < 1 / 30;
            },
            { selector: c.selector, seconds },
          ),
        { message: `${what}: ${c.name} paused at ${seconds.toFixed(2)} s` },
      )
      .toBe(true);
}

/** A row of the time bar under LIVE, by what it plays ("background", "slide:<media id>", "pip", "audio"). */
export const row = (win: Page, playing: string): Locator =>
  win.locator(`[data-testid="time-bar-row"][data-playing="${playing}"]`);

/** Click the bar `fraction` of the way along its width, in the middle of its height. */
export async function clickAlong(win: Page, bar: Locator, fraction: number): Promise<void> {
  const box = await bar.boundingBox();
  if (!box) throw new Error('the bar is not drawn');
  await win.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/**
 * A presentation of one slide with a looping video on it (not a background: it goes and comes with the slide), under
 * its words; or, `onTop`, over them in the slide's top right quarter, where the slide editor finds it by a click.
 */
export async function slideWithVideo(
  win: Page,
  dir: string,
  mediaId: string,
  onTop = false,
): Promise<string> {
  const words = join(dir, onTop ? 'Placeholder Play Bar.txt' : 'Placeholder Time Bar.txt');
  writeFileSync(words, '[Verse]\nPlaceholder words over a video\n');
  const [presentationId = ''] = await importAndGetIds(win, [words]);
  await win.evaluate(
    async ({ presentationId, mediaId, onTop }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(presentationId);
      if (!opened.ok) throw new Error(opened.message);
      const slide = opened.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('The presentation has no slide.');
      const video = {
        id: 'placeholder-slide-video',
        kind: 'video' as const,
        mediaId,
        frame: onTop ? { x: 960, y: 0, width: 960, height: 540 } : { x: 0, y: 0, width: 1920, height: 1080 },
        fit: 'fit' as const,
        loop: true,
      };
      slide.elements = onTop ? [...slide.elements, video] : [video, ...slide.elements];
      const saved = await d.library.saveSlides(presentationId, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { presentationId, mediaId, onTop },
  );
  return presentationId;
}

/** A presentation of one slide with these looping videos side by side over its lower half, under its words. */
export async function slideWithVideos(
  win: Page,
  dir: string,
  name: string,
  mediaIds: string[],
): Promise<string> {
  const words = join(dir, `${name}.txt`);
  writeFileSync(words, '[Verse]\nPlaceholder words over the videos\n');
  const [presentationId = ''] = await importAndGetIds(win, [words]);
  await win.evaluate(
    async ({ presentationId, mediaIds }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(presentationId);
      if (!opened.ok) throw new Error(opened.message);
      const slide = opened.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('The presentation has no slide.');
      const width = 1920 / mediaIds.length;
      const videos = mediaIds.map((mediaId, i) => ({
        id: `placeholder-slide-video-${String(i)}`,
        kind: 'video' as const,
        mediaId,
        frame: { x: i * width, y: 540, width, height: 540 },
        fit: 'fit' as const,
        loop: true,
      }));
      slide.elements = [...videos, ...slide.elements];
      const saved = await d.library.saveSlides(presentationId, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { presentationId, mediaIds },
  );
  return presentationId;
}
