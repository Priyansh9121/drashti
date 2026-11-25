import { describe, expect, it } from 'vitest';
import type { MediaDetails, PictureTrack, SoundTrack } from './media-details';
import {
  bitRateWords,
  channelWords,
  colourWords,
  detailSections,
  detailsText,
  detailsTitle,
  frameRateWords,
  loudnessWords,
  playsWords,
  pointsWords,
  profileWords,
  sampleRateWords,
  sizeWords,
} from './media-details';

/* Media information…'s words (alpha.20, Q60-34 item 1): what the window shows and Copy gives. Placeholder names. */

const picture: PictureTrack = {
  codec: 'h264',
  codecName: 'H.264',
  profile: 'High',
  level: '3.1',
  pixFmt: 'yuv420p',
  bitDepth: 8,
  chroma: '4:2:0',
  hdr: null,
  alpha: false,
  width: 320,
  height: 180,
  sar: '1:1',
  dar: '16:9',
  fps: 25,
  scan: 'progressive',
  bitRateKbps: null,
  language: null,
  title: null,
};

const english: SoundTrack = {
  codec: 'aac',
  codecName: 'AAC',
  profile: 'LC',
  sampleRateHz: 48000,
  channels: 'stereo',
  bitDepth: null,
  bitRateKbps: null,
  language: 'English',
  title: null,
};

const twoTracks: MediaDetails = {
  mediaId: 'm1',
  name: 'Placeholder two tracks.mkv',
  kind: 'video',
  bytes: 220_416,
  libraryDurationMs: null,
  importedAt: '2026-11-20T12:00:00.000Z',
  importedFrom: '/Placeholder folder/Placeholder two tracks.mkv',
  inDrashti: { state: 'plays' },
  read: {
    container: 'Matroska',
    durationMs: 4020,
    bitRateKbps: 440,
    title: null,
    pictures: [picture],
    sounds: [
      english,
      { ...english, channels: 'mono', language: 'Gujarati', title: 'Placeholder commentary' },
    ],
    captions: [],
    cover: null,
    chapters: 0,
  },
  problem: null,
};

describe('Media information’s window', () => {
  it('says an interlaced picture by the field that comes first', () => {
    const scanOf = (scan: PictureTrack['scan']) =>
      detailSections(
        { ...twoTracks, read: twoTracks.read && { ...twoTracks.read, pictures: [{ ...picture, scan }] } },
        {},
        'en-GB',
      )
        .find((s) => s.heading === 'Picture')
        ?.rows.find((r) => r.label === 'Scan')?.value;
    expect(scanOf('top first')).toBe('Interlaced, top field first');
    expect(scanOf('bottom first')).toBe('Interlaced, bottom field first');
    expect(scanOf('progressive')).toBe('Progressive');
    expect(scanOf(null)).toBeUndefined();
  });

  it('says the file, its picture and both sound tracks (the first is played), and how Drashti plays it', () => {
    expect(detailsTitle(twoTracks.name)).toBe('Media information: Placeholder two tracks.mkv');
    expect(
      detailSections(
        twoTracks,
        {
          points: { startMs: null, endMs: null, markers: 0 },
          loudness: { even: true, measured: true, lufs: -23.14, gainDb: 5.06 },
        },
        'en-GB',
      ),
    ).toEqual([
      {
        heading: 'The file',
        rows: [
          { label: 'What it is', value: 'Video' },
          { label: 'Container', value: 'Matroska' },
          { label: 'Length', value: '0:04' },
          { label: 'Size', value: '215.3 KB' },
          { label: 'Bit rate', value: '440 kb/s' },
          { label: 'Imported', value: '20 Nov 2026' },
          { label: 'From', value: '/Placeholder folder/Placeholder two tracks.mkv' },
        ],
      },
      {
        heading: 'Picture',
        rows: [
          { label: 'Codec', value: 'H.264' },
          { label: 'Profile', value: 'High, level 3.1' },
          { label: 'Bit depth', value: '8-bit' },
          { label: 'Colour', value: '4:2:0' },
          { label: 'Size', value: '320 × 180 (16:9)' },
          { label: 'Frame rate', value: '25 a second' },
          { label: 'Scan', value: 'Progressive' },
        ],
      },
      {
        heading: 'Sound 1 of 2',
        rows: [
          { label: 'Codec', value: 'AAC' },
          { label: 'Profile', value: 'LC' },
          { label: 'Sample rate', value: '48 kHz' },
          { label: 'Channels', value: 'Stereo' },
          { label: 'Language', value: 'English' },
          { label: 'Played', value: 'Yes' },
        ],
      },
      {
        heading: 'Sound 2 of 2',
        rows: [
          { label: 'Codec', value: 'AAC' },
          { label: 'Profile', value: 'LC' },
          { label: 'Sample rate', value: '48 kHz' },
          { label: 'Channels', value: 'Mono' },
          { label: 'Language', value: 'Gujarati' },
          { label: 'Title', value: 'Placeholder commentary' },
          { label: 'Played', value: 'No: Drashti plays the first' },
        ],
      },
      {
        heading: 'In Drashti',
        rows: [
          { label: 'Plays', value: 'As it is' },
          { label: 'Start and end', value: 'The whole file' },
          { label: 'Even loudness', value: 'Measured at -23.1 LUFS, played 5.1 dB louder' },
        ],
      },
    ]);
  });

  it('a sound alone with its cover, captions in a file, chapters and markers', () => {
    const sounds = detailSections(
      {
        ...twoTracks,
        name: 'Placeholder cover.mp3',
        kind: 'audio',
        importedAt: null,
        importedFrom: null,
        read: {
          container: 'MP3',
          durationMs: 3000,
          bitRateKbps: 65,
          title: 'Placeholder album',
          pictures: [],
          sounds: [
            {
              ...english,
              codec: 'mp3',
              codecName: 'MP3',
              profile: null,
              sampleRateHz: 44100,
              language: null,
            },
          ],
          captions: [{ codec: 'subrip', codecName: 'SubRip (SRT)', language: 'English', title: null }],
          cover: { codecName: 'JPEG', width: 32, height: 32 },
          chapters: 3,
        },
      },
      { points: { startMs: 5000, endMs: 3_720_000, markers: 2 } },
    );
    expect(sounds.map((s) => s.heading)).toEqual([
      'The file',
      'Sound',
      'Captions in the file',
      'Cover picture',
      'In Drashti',
    ]);
    expect(sounds[0]?.rows).toContainEqual({ label: 'What it is', value: 'Sound' });
    expect(sounds[0]?.rows).toContainEqual({ label: 'Title', value: 'Placeholder album' });
    expect(sounds[0]?.rows).toContainEqual({ label: 'Chapters', value: '3' });
    // One sound track: no "Played" line.
    expect(sounds[1]?.rows.map((r) => r.label)).not.toContain('Played');
    expect(sounds[2]?.rows).toEqual([{ label: 'Captions 1', value: 'English · SubRip (SRT)' }]);
    expect(sounds[3]?.rows).toEqual([{ label: 'Picture', value: 'JPEG, 32 × 32' }]);
    expect(sounds[4]?.rows).toEqual([
      { label: 'Plays', value: 'As it is' },
      { label: 'Start and end', value: '0:05 to 1:02:00' },
      { label: 'Markers', value: '2 markers' },
    ]);
  });

  it('says how many times a file has played, and when it last did (alpha.20)', () => {
    const played = detailSections(
      { ...twoTracks, plays: { count: 2, lastAt: '2026-11-20T12:00:00.000Z' } },
      {},
      'en-GB',
    );
    expect(played.at(-1)?.rows).toContainEqual({ label: 'Played', value: '2 times, last on 20 Nov 2026' });
    const never = detailSections({ ...twoTracks, plays: { count: 0, lastAt: null } });
    expect(never.at(-1)?.rows).toContainEqual({ label: 'Played', value: 'Not yet' });
  });

  it('a file that could not be read: what the library knows, and why', () => {
    const missing: MediaDetails = {
      ...twoTracks,
      bytes: null,
      libraryDurationMs: 65_000,
      importedAt: null,
      importedFrom: null,
      inDrashti: { state: 'missing' },
      read: null,
      problem: 'Drashti cannot find its file, so only what the library knows is shown.',
    };
    const sections = detailSections(missing);
    expect(sections).toEqual([
      {
        heading: 'The file',
        rows: [
          { label: 'What it is', value: 'Video' },
          { label: 'Length', value: '1:05' },
        ],
      },
      { heading: 'In Drashti', rows: [{ label: 'Plays', value: 'Its file is missing' }] },
    ]);
    expect(detailsText(missing, sections)).toBe(
      [
        'Media information: Placeholder two tracks.mkv',
        'Drashti cannot find its file, so only what the library knows is shown.',
        '',
        'The file',
        '  What it is: Video',
        '  Length: 1:05',
        '',
        'In Drashti',
        '  Plays: Its file is missing',
        '',
      ].join('\n'),
    );
  });
});

describe('the words for each thing', () => {
  it('sizes and shapes, square pixels or not', () => {
    expect(sizeWords({ width: 1920, height: 1080, sar: '1:1', dar: '16:9' })).toBe('1920 × 1080 (16:9)');
    expect(sizeWords({ width: 720, height: 576, sar: '64:45', dar: '16:9' })).toBe(
      '720 × 576, shown as 16:9',
    );
    expect(sizeWords({ width: 1080, height: 1920, sar: '1:1', dar: '9:16' })).toBe('1080 × 1920 (9:16)');
    // Within 1% of a common shape, it is named; FFmpeg's own odd ratio never is.
    expect(sizeWords({ width: 1366, height: 768, sar: '1:1', dar: '683:384' })).toBe('1366 × 768 (16:9)');
    expect(sizeWords({ width: 1000, height: 517, sar: null, dar: null })).toBe('1000 × 517');
  });

  it('rates, channels, colour and profile', () => {
    expect(bitRateWords(72)).toBe('72 kb/s');
    expect(bitRateWords(17_800)).toBe('17.8 Mb/s');
    expect(bitRateWords(2000)).toBe('2 Mb/s');
    expect(sampleRateWords(48_000)).toBe('48 kHz');
    expect(sampleRateWords(44_100)).toBe('44.1 kHz');
    expect(sampleRateWords(22_050)).toBe('22.05 kHz');
    expect(frameRateWords(25)).toBe('25 a second');
    expect(frameRateWords(29.97)).toBe('29.97 a second');
    expect(channelWords('mono')).toBe('Mono');
    expect(channelWords('stereo')).toBe('Stereo');
    expect(channelWords('5.1(side)')).toBe('5.1 surround');
    expect(channelWords('7.1')).toBe('7.1 surround');
    expect(channelWords('2.1')).toBe('2.1');
    expect(channelWords('3 channels')).toBe('3 channels');
    expect(channelWords('quad')).toBe('Quad (4 channels)');
    expect(colourWords({ chroma: '4:2:0', hdr: 'pq', alpha: false })).toBe('4:2:0, HDR (PQ)');
    expect(colourWords({ chroma: '4:2:0', hdr: 'hlg', alpha: false })).toBe('4:2:0, HDR (HLG)');
    expect(colourWords({ chroma: '4:4:4', hdr: null, alpha: true })).toBe('4:4:4, with transparency');
    expect(colourWords({ chroma: null, hdr: null, alpha: false })).toBeNull();
    expect(profileWords('High', '3.1')).toBe('High, level 3.1');
    expect(profileWords('Main 10', null)).toBe('Main 10');
    expect(profileWords(null, '4')).toBe('Level 4');
    expect(profileWords(null, null)).toBeNull();
  });

  it('how Drashti plays it, its points and its Even loudness', () => {
    expect(playsWords({ state: 'plays' })).toBe('As it is');
    expect(playsWords({ state: 'maybe' })).toBe('As it is, where this computer can draw it');
    expect(playsWords({ state: 'converted', copy: 'Placeholder clip.mp4' })).toBe(
      'Converted: everything uses “Placeholder clip.mp4”',
    );
    expect(playsWords({ state: 'copy', of: 'Placeholder clip.mov' })).toBe(
      'As it is: a copy Drashti made of “Placeholder clip.mov”',
    );
    expect(playsWords({ state: 'converting' })).toBe('Being converted to a copy that plays');
    expect(playsWords({ state: 'cannot', format: 'ProRes 422 HQ video (QuickTime)' })).toBe(
      'Not as it is (ProRes 422 HQ video (QuickTime)): convert it in Media',
    );
    expect(playsWords({ state: 'missing' })).toBe('Its file is missing');
    expect(pointsWords(null, null)).toBe('The whole file');
    expect(pointsWords(5000, null)).toBe('From 0:05');
    expect(pointsWords(null, 3_720_000)).toBe('Up to 1:02:00');
    expect(loudnessWords({ even: false, measured: true, lufs: -20, gainDb: 0 })).toBe(
      'Off: played as it is in its file',
    );
    expect(loudnessWords({ even: true, measured: false, lufs: null, gainDb: 0 })).toBe('Not measured yet');
    expect(loudnessWords({ even: true, measured: true, lufs: null, gainDb: 0 })).toBe('No sound to measure');
    expect(loudnessWords({ even: true, measured: true, lufs: -14, gainDb: -2 })).toBe(
      'Measured at -14 LUFS, played 2 dB quieter',
    );
    expect(loudnessWords({ even: true, measured: true, lufs: -18, gainDb: 0 })).toBe(
      'Measured at -18 LUFS, played as it is',
    );
  });
});

describe('a video’s smaller copies for crossfades (QA23-FADE-9 candidate 1, a22-review-fadecopies S5)', () => {
  const smaller = (pageCopies: number[] | null) =>
    detailSections(twoTracks, { pageCopies })
      .find((s) => s.heading === 'In Drashti')
      ?.rows.find((r) => r.label === 'Smaller copies')?.value ?? null;
  it('says which are made, for the stream and for LIVE; nothing when there are none', () => {
    expect(smaller([540, 720])).toBe(
      '720p for the stream and 540p for LIVE, for crossfades on this computer',
    );
    expect(smaller([720])).toBe('720p for the stream, for crossfades on this computer');
    expect(smaller([540])).toBe('540p for LIVE, for crossfades on this computer');
    expect(smaller([])).toBeNull();
    expect(smaller(null)).toBeNull();
  });
});
