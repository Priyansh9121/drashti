import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mediaUrl } from '../../src/shared/media';
import { importAndGetIds } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { dispatch, snapshot } from './time-bar-helpers';
import type { PageGlobals } from './helpers';
import { cueReady, setupVideoCue } from './video-cue-helpers';

/** Cause experiment only: production is unchanged; the normal S5 specs remain the acceptance gate. */
for (const mode of ['disabled track', 'absent track'] as const)
  test(`A cued picture with ${mode} starts on its native video clock`, async () => {
    const { app, win, hall, stream, audio, ids, dir } = await setupVideoCue();
    const pages = [hall, win, stream];
    const id = ids[1] ?? '';
    let goAt: number | null = null;
    try {
      await win.evaluate(async (id) => {
        const d = (globalThis as PageGlobals).drashti;
        await d.media.setMarkers(id, { startMs: 1000, endMs: 7000, markers: [] });
      }, id);
      if (mode === 'absent track') {
        const ffmpeg = testFfmpeg();
        if (!ffmpeg) throw new Error('No bundled encoder for the generated cause fixture');
        const source = join(dir, 'Placeholder blue.webm');
        const before = readFileSync(source);
        const picture = join(dir, 'Placeholder picture track.webm');
        const remux = spawnSync(ffmpeg, [
          '-v',
          'error',
          '-nostdin',
          '-copyts',
          '-i',
          source,
          '-map',
          '0:v:0',
          '-c:v',
          'copy',
          '-an',
          '-y',
          picture,
        ]);
        expect(remux.status, 'only the generated video packets are copied, without encoding').toBe(0);
        expect(readFileSync(source), 'the generated source remains byte-for-byte unchanged').toEqual(before);
        const pictureId = (await importAndGetIds(win, [picture]))[0];
        if (!pictureId) throw new Error('No generated picture-track copy');
        for (const page of pages)
          await page.evaluate(
            ({ id, url }) => {
              const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
              if (!source?.set) throw new Error('No native source setter for the cause fixture');
              Object.defineProperty(HTMLMediaElement.prototype, 'src', {
                ...source,
                set(this: HTMLMediaElement, value: string) {
                  source.set?.call(
                    this,
                    this instanceof HTMLVideoElement && this.dataset['mediaId'] === id ? url : value,
                  );
                },
              });
            },
            { id, url: mediaUrl(pictureId) },
          );
      } else {
        for (const page of pages)
          await page.evaluate((id) => {
            document.addEventListener(
              'loadedmetadata',
              (event) => {
                const v = event.target;
                if (!(v instanceof HTMLVideoElement) || v.dataset['mediaId'] !== id) return;
                const tracks = (
                  v as HTMLVideoElement & {
                    audioTracks?: { length: number; [index: number]: { enabled: boolean } };
                  }
                ).audioTracks;
                if (!tracks) throw new Error('No native audio-track selection for the cause experiment');
                for (const track of Array.from(tracks)) track.enabled = false;
              },
              true,
            );
          }, id);
      }
      await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#205020' } });
      expect((await dispatch(win, { type: 'cueVideo', mediaId: id })).ok).toBe(true);
      await cueReady(win);
      for (const page of pages) {
        const v = page.locator(`video[data-media-id="${id}"]`).first();
        await expect(v).toHaveJSProperty('paused', true);
        await v.evaluate((v: HTMLVideoElement) => {
          const initial = v.currentTime;
          const frames: { expected: number; mediaTime: number; currentTime: number }[] = [];
          const observe: VideoFrameRequestCallback = (_now, frame) => {
            frames.push({
              expected: Date.now() + frame.expectedDisplayTime - performance.now(),
              mediaTime: frame.mediaTime,
              currentTime: v.currentTime,
            });
            v.dataset['clockFrames'] = JSON.stringify(frames);
            if (frame.mediaTime > initial + 0.001)
              v.dataset['clockMotion'] = String(Date.now() + frame.expectedDisplayTime - performance.now());
            else v.requestVideoFrameCallback(observe);
          };
          v.requestVideoFrameCallback(observe);
        });
      }
      await expect(audio.locator(`audio[data-media-id="${id}"]`)).toHaveJSProperty('paused', true);
      await win.getByRole('button', { name: 'Go cued video', exact: true }).click();
      const bg = (await snapshot(win)).layers.background;
      if (bg?.kind !== 'media' || !bg.seek) throw new Error('No scheduled Go for the clock experiment');
      goAt = bg.seek.at;
      const motion: number[] = [];
      for (const page of pages) {
        const v = page.locator(`video[data-media-id="${id}"]`).first();
        await expect(v).toHaveAttribute('data-clock-motion', /[1-9]/);
        motion.push(Number(await v.getAttribute('data-clock-motion')));
      }
      for (const at of motion) {
        expect(at - goAt).toBeGreaterThanOrEqual(0);
        expect(at - goAt, 'first motion within one 30 fps frame').toBeLessThanOrEqual(1000 / 30);
      }
    } finally {
      const rows = await Promise.all(
        pages.map((page) =>
          page.evaluate((id) => {
            const v = document.querySelector<HTMLVideoElement>(`video[data-media-id="${id}"]`);
            if (!v) return null;
            const tracks = (
              v as HTMLVideoElement & {
                audioTracks?: { length: number; [index: number]: { enabled: boolean } };
              }
            ).audioTracks;
            return {
              available: tracks !== undefined,
              audioTracks: tracks ? Array.from(tracks).map((t) => t.enabled) : null,
              frames: JSON.parse(v.dataset['clockFrames'] ?? '[]') as unknown,
              motion: Number(v.dataset['clockMotion']),
            };
          }, id),
        ),
      );
      await test.info().attach('s5-picture-clock.json', {
        body: Buffer.from(JSON.stringify({ mode, goAt, rows })),
        contentType: 'application/json',
      });
      await app.close();
    }
  });
