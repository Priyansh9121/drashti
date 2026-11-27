import { describe, expect, it } from 'vitest';
import {
  aboveTheUsual,
  checkLink,
  chosenHeight,
  downloadHostAllowed,
  linkQualities,
  qualityChoice,
  qualityWords,
  type VideoDetails,
} from './links';

/*
 * Made-up links only (PLAN §6): no real Dropbox file or folder is named here.
 */

const FILE =
  'https://www.dropbox.com/scl/fi/abc123placeholder/Placeholder%20clip.mp4?rlkey=placeholderkey&dl=0';
const FOLDER = 'https://www.dropbox.com/scl/fo/abc123placeholder/def456placeholder?rlkey=placeholderkey&dl=0';

const ok = (r: ReturnType<typeof checkLink>) => (r.ok ? r : null);
const message = (r: ReturnType<typeof checkLink>) => (r.ok ? '' : r.message);

describe('checking a pasted Dropbox link', () => {
  it('takes a link to a file, and asks Dropbox for the file itself (dl=1)', () => {
    const r = ok(checkLink('dropbox', FILE));
    expect(r?.shape).toBe('file');
    const url = new URL(r?.url ?? '');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('www.dropbox.com');
    expect(url.searchParams.getAll('dl')).toEqual(['1']);
    expect(url.searchParams.get('rlkey')).toBe('placeholderkey');
  });

  it('takes a link to a folder (it comes as a zip)', () => {
    expect(ok(checkLink('dropbox', FOLDER))?.shape).toBe('folder');
  });

  it('takes the older forms of shared links, and spaces around a pasted link', () => {
    expect(
      ok(checkLink('dropbox', '  https://www.dropbox.com/s/abc123placeholder/Placeholder.pptx?dl=0 \n'))
        ?.shape,
    ).toBe('file');
    expect(
      ok(checkLink('dropbox', 'https://dropbox.com/sh/abc123placeholder/def456placeholder'))?.shape,
    ).toBe('folder');
  });

  it('drops raw=1, which would show the file instead of downloading it', () => {
    const r = ok(checkLink('dropbox', FILE.replace('dl=0', 'raw=1')));
    const url = new URL(r?.url ?? '');
    expect(url.searchParams.has('raw')).toBe(false);
    expect(url.searchParams.get('dl')).toBe('1');
  });

  it('refuses anything but https', () => {
    expect(message(checkLink('dropbox', FILE.replace('https:', 'http:')))).toMatch(/https/u);
    expect(message(checkLink('dropbox', 'ftp://www.dropbox.com/s/abc/x.mp4'))).toMatch(/https/u);
  });

  it("refuses addresses that are not Dropbox's own", () => {
    for (const bad of [
      'https://www.dropbox.com.example.net/scl/fi/abc/x.mp4',
      'https://example.net/www.dropbox.com/scl/fi/abc/x.mp4',
      'https://www.dropbox.com@example.net/scl/fi/abc/x.mp4',
      'https://user:secret@www.dropbox.com/scl/fi/abc/x.mp4',
      'https://www.dropbox.com:8443/scl/fi/abc/x.mp4',
      'https://dl.dropboxusercontent.com/scl/fi/abc/x.mp4',
      'https://127.0.0.1/scl/fi/abc/x.mp4',
    ])
      expect(message(checkLink('dropbox', bad)), bad).not.toBe('');
    expect(message(checkLink('dropbox', 'https://example.net/x.mp4'))).toMatch(/not a Dropbox link/u);
  });

  it('says plainly when a YouTube link was pasted under Dropbox', () => {
    expect(message(checkLink('dropbox', 'https://www.youtube.com/watch?v=AAAAAAAAAAA'))).toMatch(
      /YouTube link/u,
    );
  });

  it('refuses Dropbox pages that are not a shared file or folder', () => {
    expect(message(checkLink('dropbox', 'https://www.dropbox.com/home'))).toMatch(/Copy link/u);
    expect(message(checkLink('dropbox', 'https://www.dropbox.com/scl/fi/'))).toMatch(/Copy link/u);
  });

  it('says what to do with an empty box, words that are not a link, and a link far too long', () => {
    expect(message(checkLink('dropbox', ''))).toMatch(/Paste/u);
    expect(message(checkLink('dropbox', 'placeholder words'))).toMatch(/not a link/u);
    expect(message(checkLink('dropbox', `${FILE}&x=${'a'.repeat(3000)}`))).toMatch(/too long/u);
  });
});

describe('checking a pasted YouTube link (Session 25c)', () => {
  // A made-up video id (eleven As) and made-up share codes: no real video is named here.
  const ID = 'AAAAAAAAAAA';
  const VIDEO = `https://www.youtube.com/watch?v=${ID}`;

  it('takes the addresses YouTube’s Share button gives for one video, as the video’s own page', () => {
    for (const link of [
      `https://youtu.be/${ID}?si=placeholderShare`,
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&si=placeholderShare`,
      `https://youtube.com/shorts/${ID}?si=placeholderShare`,
      `https://www.youtube.com/live/${ID}?si=placeholderShare`,
      `  https://youtu.be/${ID}  `,
    ]) {
      const r = ok(checkLink('youtube', link));
      expect(r, link).not.toBeNull();
      expect(r?.shape).toBe('video');
      expect(r?.url).toBe(VIDEO);
    }
  });

  it('takes only the video from a link that also names a playlist', () => {
    expect(
      ok(checkLink('youtube', `https://www.youtube.com/watch?v=${ID}&list=PLplaceholder&index=3`))?.url,
    ).toBe(VIDEO);
    expect(ok(checkLink('youtube', `https://youtu.be/${ID}?list=PLplaceholder`))?.url).toBe(VIDEO);
  });

  it('says plainly what a playlist, a channel and other pages are', () => {
    expect(message(checkLink('youtube', 'https://www.youtube.com/playlist?list=PLplaceholder'))).toMatch(
      /That is a playlist\. Drashti downloads one video at a time/u,
    );
    for (const page of [
      'https://www.youtube.com/@placeholderchannel',
      'https://www.youtube.com/channel/UCplaceholder',
      'https://www.youtube.com/results?search_query=placeholder',
      'https://www.youtube.com/',
      'https://studio.youtube.com/video/AAAAAAAAAAA/edit',
    ])
      expect(message(checkLink('youtube', page)), page).toMatch(/not a video/u);
  });

  it('refuses http, other sites, look-alikes, odd ids and Dropbox links', () => {
    expect(message(checkLink('youtube', `http://youtu.be/${ID}`))).toMatch(/https:\/\//u);
    expect(message(checkLink('youtube', `https://youtube.com.example.net/watch?v=${ID}`))).toMatch(
      /not a YouTube link/u,
    );
    expect(message(checkLink('youtube', `https://example.net/watch?v=${ID}`))).toMatch(/not a YouTube link/u);
    expect(message(checkLink('youtube', `https://placeholder@youtu.be/${ID}`))).toMatch(
      /not a YouTube link/u,
    );
    expect(message(checkLink('youtube', `https://youtu.be:8443/${ID}`))).toMatch(/not a YouTube link/u);
    for (const id of ['AAAAAAAAAA', 'AAAAAAAAAAAA', 'AAAAAAAAAA!', ''])
      expect(message(checkLink('youtube', `https://www.youtube.com/watch?v=${id}`)), id).toMatch(
        /does not name a video/u,
      );
    expect(message(checkLink('youtube', FILE))).toMatch(/Dropbox link, not a YouTube link/u);
    expect(message(checkLink('youtube', `${VIDEO}&x=${'a'.repeat(3000)}`))).toMatch(
      /too long to be one from YouTube/u,
    );
  });
});

describe('where a Dropbox download may be sent on to', () => {
  it("allows only https to Dropbox's own addresses", () => {
    expect(downloadHostAllowed('https://www.dropbox.com/scl/fi/abc/x.mp4?dl=1')).toBe(true);
    expect(downloadHostAllowed('https://uc0placeholder.dl.dropboxusercontent.com/cd/0/get/x/file')).toBe(
      true,
    );
    expect(downloadHostAllowed('https://dl.dropboxusercontent.com/x')).toBe(true);
  });

  it('refuses http, other hosts and look-alikes', () => {
    for (const bad of [
      'http://uc0.dl.dropboxusercontent.com/x',
      'https://dropboxusercontent.com.example.net/x',
      'https://example.net/dropbox.com',
      'https://evildropbox.com/x',
      'https://10.0.0.1/x',
      'https://user@www.dropbox.com/x',
      'not a link',
    ])
      expect(downloadHostAllowed(bad), bad).toBe(false);
  });
});

describe('the YouTube quality a download asks for (Session 25c)', () => {
  const video: VideoDetails = {
    title: 'Placeholder video',
    duration: 65,
    heights: [4320, 2160, 1440, 1080, 720].map((height) => ({ height, bytes: null })),
    soundBytes: null,
  };

  it('is the tallest the setting allows until one is picked', () => {
    expect(chosenHeight(video, 1080, null)).toBe(1080);
    expect(chosenHeight(video, 2160, null)).toBe(2160);
    expect(chosenHeight({ ...video, heights: [{ height: 720, bytes: null }] }, 1080, null)).toBe(720);
  });

  it('is the one picked while the video offers it and the setting allows it, else the tallest allowed', () => {
    expect(chosenHeight(video, 1080, 720)).toBe(720);
    // The setting was lowered after 2160p was picked.
    expect(chosenHeight(video, 1080, 2160)).toBe(1080);
    expect(chosenHeight(video, 1080, 999)).toBe(1080);
  });

  it('is none when every height is above the setting', () => {
    expect(chosenHeight({ ...video, heights: [{ height: 2160, bytes: null }] }, 1080, null)).toBeNull();
  });
});

describe('the quality a Download takes: the window’s Quality (alpha.24)', () => {
  const video: VideoDetails = {
    title: 'Placeholder video',
    duration: 100,
    heights: [2160, 1440, 1080, 720, 360].map((height) => ({ height, bytes: null })),
    soundBytes: null,
  };

  it('is the usual when none is chosen: the best up to 1080p, or the best sound', () => {
    expect(qualityChoice(video, false, undefined)).toEqual({
      ok: true,
      choice: { type: 'mp4', height: 1080 },
    });
    expect(qualityChoice(video, false, null)).toEqual({ ok: true, choice: { type: 'mp4', height: 1080 } });
    expect(qualityChoice(video, true, undefined)).toEqual({
      ok: true,
      choice: { type: 'mp3', height: null },
    });
    expect(qualityChoice(video, true, 0)).toEqual({ ok: true, choice: { type: 'mp3', height: null } });
  });

  it('is the height chosen while the video offers it, above 1080p too; for an MP3 the bitrate chosen', () => {
    expect(qualityChoice(video, false, 720)).toEqual({ ok: true, choice: { type: 'mp4', height: 720 } });
    expect(qualityChoice(video, false, 2160)).toEqual({ ok: true, choice: { type: 'mp4', height: 2160 } });
    expect(qualityChoice(video, true, 192)).toEqual({
      ok: true,
      choice: { type: 'mp3', height: null, kbps: 192 },
    });
    expect(qualityChoice(video, true, 128)).toEqual({
      ok: true,
      choice: { type: 'mp3', height: null, kbps: 128 },
    });
  });

  it('refuses in words a height the video does not offer, and a bitrate not offered', () => {
    expect(qualityChoice(video, false, 480)).toEqual({
      ok: false,
      message: 'That quality is not offered by this video. Choose another under Quality.',
    });
    expect(qualityChoice(video, false, 0)).toMatchObject({ ok: false });
    expect(qualityChoice(video, true, 320)).toEqual({
      ok: false,
      message: 'Choose Best, 192 kbps or 128 kbps for the sound.',
    });
  });

  it('keeps today’s words when no height is at 1080p or below and none was chosen', () => {
    const tall = { ...video, heights: [{ height: 2160, bytes: null }] };
    expect(qualityChoice(tall, false, undefined)).toEqual({
      ok: false,
      message: 'This video has no quality at or below 1080p. Paste another YouTube link.',
    });
    expect(qualityChoice(tall, false, 2160)).toEqual({ ok: true, choice: { type: 'mp4', height: 2160 } });
    expect(qualityChoice(tall, true, undefined)).toEqual({ ok: true, choice: { type: 'mp3', height: null } });
  });

  it('says a choice in the status bar’s words: its height, or MP3 and its bitrate', () => {
    expect(qualityWords({ type: 'mp4', height: 720 })).toBe('720p');
    expect(qualityWords({ type: 'mp4', height: 2160 })).toBe('2160p (4K)');
    expect(qualityWords({ type: 'mp3', height: null })).toBe('MP3');
    expect(qualityWords({ type: 'mp3', height: null, kbps: 192 })).toBe('MP3 at 192 kbps');
  });
});

describe('an upright video’s Quality, by the short side of its picture (alpha.24, hunt S3-2)', () => {
  // A phone's upright video: 1080 × 1920 is YouTube's 1080p, 2160 × 3840 its 4K.
  const video: VideoDetails = {
    title: 'Placeholder upright video',
    duration: 30,
    heights: [
      { height: 3840, side: 2160, bytes: null },
      { height: 1920, side: 1080, bytes: null },
      { height: 1280, side: 720, bytes: null },
      { height: 854, side: 480, bytes: null },
    ],
    soundBytes: null,
  };

  it('begins at its 1080p (1080 × 1920), and a setting of 1080p allows that, never its 4K', () => {
    expect(chosenHeight(video, 1080, null)).toBe(1920);
    expect(chosenHeight(video, 1080, 1280)).toBe(1280);
    expect(chosenHeight(video, 1080, 3840)).toBe(1920);
    expect(chosenHeight(video, 2160, 3840)).toBe(3840);
    expect(qualityChoice(video, false, undefined)).toEqual({ ok: true, choice: { type: 'mp4', height: 1920 } });
    expect(qualityChoice(video, false, 3840)).toEqual({ ok: true, choice: { type: 'mp4', height: 3840 } });
    expect(linkQualities(video, false).initial).toBe(1920);
  });

  it('is named and judged by it, while the download keeps the real height', () => {
    expect(linkQualities(video, false).options).toEqual([
      { value: 3840, label: '2160p (4K)', bytes: null },
      { value: 1920, label: '1080p', bytes: null },
      { value: 1280, label: '720p', bytes: null },
      { value: 854, label: '480p', bytes: null },
    ]);
    expect([3840, 1920, 1280, 854].map((h) => aboveTheUsual(video, h))).toEqual([true, false, false, false]);
    expect(qualityWords({ type: 'mp4', height: 1920 }, video)).toBe('1080p');
    expect(qualityWords({ type: 'mp4', height: 3840 }, video)).toBe('2160p (4K)');
    // Without the video, or a height it does not list: the height, as before.
    expect(qualityWords({ type: 'mp4', height: 1920 })).toBe('1920p');
    expect(qualityWords({ type: 'mp4', height: 999 }, video)).toBe('999p');
    expect(qualityWords({ type: 'mp3', height: null, kbps: 128 }, video)).toBe('MP3 at 128 kbps');
  });

  it('leaves a landscape video as it was: its height is its short side', () => {
    const wide: VideoDetails = {
      ...video,
      heights: [2160, 1440, 1080, 720].map((height) => ({ height, bytes: null })),
    };
    expect([2160, 1440, 1080, 720].map((h) => aboveTheUsual(wide, h))).toEqual([true, true, false, false]);
    expect(chosenHeight(wide, 1080, null)).toBe(1080);
    expect(qualityWords({ type: 'mp4', height: 1440 }, wide)).toBe('1440p');
    expect(linkQualities(wide, false).options.map((o) => o.label)).toEqual([
      '2160p (4K)',
      '1440p',
      '1080p',
      '720p',
    ]);
  });
});
