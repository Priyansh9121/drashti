import type { Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * A small placeholder sabha for the UI tests, Simple Mode and the
 * screenshots: a welcome slide, a kirtan with a chorus sung three times, a
 * generated picture, and a playlist of them with headers; a prop (the
 * logo), a message template and a timer. Placeholder words only.
 */

export const WELCOME = 'Placeholder Welcome';
export const KIRTAN = 'Placeholder Kirtan';
export const PICTURE = 'Placeholder backdrop';
export const PLAYLIST = 'Placeholder Ravi Sabha';
export const LOGO = 'Placeholder Mandir Logo';
export const VIDEO = 'Placeholder clip';

export interface PlaceholderShow {
  playlistId: string;
  welcomeId: string;
  kirtanId: string;
  pictureMediaId: string;
  /** With `video`: a short generated video, the item after the kirtan. */
  videoMediaId: string | null;
  logoPropId: string;
  /** The kirtan's slides in playing order: chorus, verse 1, chorus, verse 2, chorus. */
  kirtanOrder: string[];
}

export async function setUpPlaceholderShow(
  win: Page,
  options: { video?: boolean } = {},
): Promise<PlaceholderShow> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-show-'));
  const welcome = join(dir, `${WELCOME}.txt`);
  writeFileSync(welcome, 'Placeholder welcome to the sabha\nનમૂના સ્વાગત\n');
  const kirtan = join(dir, `${KIRTAN}.txt`);
  writeFileSync(
    kirtan,
    [
      '[Chorus]',
      'Placeholder chorus line',
      'નમૂના ટેક પંક્તિ',
      '',
      '[Verse 1]',
      'Placeholder first verse',
      'नमूना पहला अंतरा',
      '',
      '[Chorus]',
      '',
      '[Verse 2]',
      'Placeholder second verse',
      '',
      '[Chorus]',
      '',
    ].join('\n'),
  );
  const picture = await makeTestImage(win, join(dir, `${PICTURE}.png`), {
    width: 320,
    height: 180,
    color: '#1d4e89',
  });
  const video = options.video
    ? await makeTestVideo(win, join(dir, `${VIDEO}.webm`), { seconds: 2, width: 320, height: 180, hue: 30 })
    : null;
  const [welcomeId = '', kirtanId = ''] = await importAndGetIds(win, [
    welcome,
    kirtan,
    picture,
    ...(video ? [video] : []),
  ]);
  return win.evaluate(
    async ({ welcomeId: welcomeFromReport, kirtanId: kirtanFromReport, names, withVideo }) => {
      const d = (globalThis as PageGlobals).drashti;
      // The report names each file's presentation; the library list by name is the fallback.
      const listed = await d.library.listPresentations();
      const byName = (name: string) => listed.find((p) => p.name === name)?.id ?? '';
      const welcomeId = welcomeFromReport || byName(names.welcome);
      const kirtanId = kirtanFromReport || byName(names.kirtan);
      const media = await d.library.listMedia();
      const pictureMediaId = media.find((m) => m.name.startsWith(names.picture))?.id ?? '';
      const videoMediaId = withVideo ? (media.find((m) => m.name.startsWith(names.video))?.id ?? '') : null;
      const missing = Object.entries({ welcomeId, kirtanId, pictureMediaId, videoMediaId })
        .filter(([, v]) => v === '')
        .map(([k]) => k);
      if (missing.length > 0)
        throw new Error(
          `The placeholder show is missing ${missing.join(', ')}: presentations ${JSON.stringify(listed.map((p) => p.name))}, media ${JSON.stringify(media.map((m) => m.name))}`,
        );
      const made = await d.playlists.create(names.playlist, null, false);
      if (!made.ok) throw new Error(made.message);
      const playlistId = made.ids[0] ?? '';
      const added = await d.playlists.addItems(playlistId, null, [
        { kind: 'header', label: 'Welcome' },
        { kind: 'presentation', presentationId: welcomeId },
        { kind: 'header', label: 'Kirtan' },
        { kind: 'presentation', presentationId: kirtanId },
        ...(videoMediaId ? [{ kind: 'media' as const, mediaId: videoMediaId }] : []),
        { kind: 'media', mediaId: pictureMediaId },
      ]);
      if (!added.ok) throw new Error(added.message);
      const logo = await d.props.save(null, {
        name: names.logo,
        width: 1920,
        height: 1080,
        elements: [
          {
            id: 'placeholder-logo-text',
            kind: 'text',
            frame: { x: 360, y: 440, width: 1200, height: 200 },
            text: names.logo,
            lang: 'en',
            style: {
              fontFamily: null,
              fontSize: 96,
              fontWeight: 700,
              color: '#ffffff',
              align: 'center',
              verticalAlign: 'middle',
              lineHeight: 1.2,
              shadow: false,
            },
          },
        ],
      });
      if (!logo.ok) throw new Error(logo.message);
      const message = await d.messages.create({
        name: 'Car parking',
        template: 'Car {plate} please move',
        fields: {},
      });
      if (!message.ok) throw new Error(message.message);
      const timer = await d.timers.create({
        name: 'Sabha starts in',
        kind: 'countdown',
        durationMs: 300_000,
        targetTime: null,
        allowsOverrun: false,
      });
      if (!timer.ok) throw new Error(timer.message);
      const doc = await d.library.getPresentation(kirtanId);
      const arrangement = doc?.arrangements.find((a) => a.id === doc.selectedArrangementId);
      const byGroup = new Map(doc?.groups.map((g) => [g.id, g.slides.map((sl) => sl.id)]) ?? []);
      const kirtanOrder = (arrangement?.groupIds ?? []).flatMap((g) => byGroup.get(g) ?? []);
      return {
        playlistId,
        welcomeId,
        kirtanId,
        pictureMediaId,
        videoMediaId,
        logoPropId: logo.id,
        kirtanOrder,
      };
    },
    {
      welcomeId,
      kirtanId,
      names: {
        picture: PICTURE,
        playlist: PLAYLIST,
        logo: LOGO,
        video: VIDEO,
        welcome: WELCOME,
        kirtan: KIRTAN,
      },
      withVideo: Boolean(video),
    },
  );
}
