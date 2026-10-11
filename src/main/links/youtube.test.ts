import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  downloadArgs,
  lookArgs,
  parseDetails,
  parseProgress,
  PROGRESS_MARK,
  youtubeProblem,
} from './youtube';
import {
  DENO_AS_YT_DLP_RUNS_IT,
  toolEnv,
  toolFolders,
  youtubeLaunch,
  type LaunchPlace,
} from './youtube-tools';

/*
 * YouTube in Import from a Link (Session 25c): exactly what Drashti passes
 * yt-dlp, the environment it builds for it, the test guard, and how yt-dlp's
 * answers are read. A made-up video (eleven As) and made-up output only: no
 * test names or contacts a real video.
 */

const LINK = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
const PATHS = { deno: '/Drashti/Resources/deno/deno', ffmpeg: '/Drashti/Resources/ffmpeg/ffmpeg' };
const WORK = '/Saved here/.drashti-youtube-placeholder';

/** Nothing of the user's: these come first, in every run. */
const NOTHING_OF_THE_USERS = [
  '--ignore-config',
  '--no-plugin-dirs',
  '--no-cookies',
  '--no-cookies-from-browser',
  '--no-cache-dir',
  '--proxy',
  '',
  '--no-playlist',
  '--no-update',
  '--no-remote-components',
  '--no-sponsorblock',
  '--no-js-runtimes',
  '--js-runtimes',
  'deno:/Drashti/Resources/deno/deno',
  '--ffmpeg-location',
  '/Drashti/Resources/ffmpeg/ffmpeg',
  '--color',
  'never',
];

describe('what Drashti asks of yt-dlp', () => {
  it('asks for the details only, with nothing of the user’s', () => {
    expect(lookArgs(PATHS, LINK)).toEqual([...NOTHING_OF_THE_USERS, '--dump-single-json', '--', LINK]);
  });

  it('downloads an MP4 at the height chosen at most, H.264 and AAC where offered, into the work folder', () => {
    expect(downloadArgs(PATHS, LINK, { type: 'mp4', height: 1080 }, WORK)).toEqual([
      ...NOTHING_OF_THE_USERS,
      '-f',
      'bv*[height<=1080]+ba/b[height<=1080]',
      '-S',
      'res:1080,vcodec:h264,acodec:aac',
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4',
      '--newline',
      '--progress-template',
      `download:${PROGRESS_MARK} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
      '--continue',
      '--no-overwrites',
      '--no-mtime',
      '-P',
      WORK,
      '-o',
      'download.%(ext)s',
      '--',
      LINK,
    ]);
    expect(downloadArgs(PATHS, LINK, { type: 'mp4', height: 2160 }, WORK)).toContain(
      'bv*[height<=2160]+ba/b[height<=2160]',
    );
  });

  it('downloads an MP3 of the best sound', () => {
    const args = downloadArgs(PATHS, LINK, { type: 'mp3', height: null }, WORK);
    expect(args.slice(NOTHING_OF_THE_USERS.length, NOTHING_OF_THE_USERS.length + 8)).toEqual([
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--newline',
    ]);
    expect(args.join(' ')).not.toMatch(/height/u);
  });

  it('never passes cookies, a browser, a settings file, a plugin, a playlist or an update', () => {
    for (const args of [
      lookArgs(PATHS, LINK),
      downloadArgs(PATHS, LINK, { type: 'mp4', height: 720 }, WORK),
      downloadArgs(PATHS, LINK, { type: 'mp3', height: null }, WORK),
    ]) {
      for (const never of [
        '--cookies',
        '--cookies-from-browser',
        '--config-locations',
        '--plugin-dirs',
        '--yes-playlist',
        '--update',
        '-U',
        '--remote-components',
        '--sponsorblock-remove',
        '--sponsorblock-mark',
        '--exec',
        '--username',
        '--password',
        '--netrc',
      ])
        expect(args, never).not.toContain(never);
      // The link is always last, after "--" (never read as an option).
      expect(args.at(-2)).toBe('--');
      expect(args.at(-1)).toBe(LINK);
    }
  });

  it('starts Deno only as yt-dlp 2026.08.19 does: no --allow-*, the script on its standard input', () => {
    expect(DENO_AS_YT_DLP_RUNS_IT).toEqual([
      'run',
      '--ext=js',
      '--no-code-cache',
      '--no-prompt',
      '--no-remote',
      '--no-lock',
      '--node-modules-dir=none',
      '--no-config',
      '--no-npm',
      '--cached-only',
      '-',
    ]);
    expect(DENO_AS_YT_DLP_RUNS_IT.some((a) => a.startsWith('--allow'))).toBe(false);
  });
});

describe('the environment yt-dlp and Deno get', () => {
  /** The user's own variables, as this computer might have them. */
  const USERS = {
    PATH: '/opt/placeholder/bin:/usr/bin',
    HOME: '/Users/placeholder',
    DENO_DIR: '/Users/placeholder/deno-cache',
    DENO_AUTH_TOKENS: 'placeholder@example.net',
    DENO_CERT: '/placeholder.pem',
    NODE_OPTIONS: '--require /placeholder.js',
    NODE_EXTRA_CA_CERTS: '/placeholder.pem',
    PYTHONPATH: '/placeholder',
    PYTHONHOME: '/placeholder',
    PYTHONSTARTUP: '/placeholder.py',
    YTDLP_PLACEHOLDER: '1',
    XDG_CONFIG_HOME: '/Users/placeholder/.config',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'socks5://127.0.0.1:1',
    NO_PROXY: '*',
    http_proxy: 'http://127.0.0.1:1',
    SSL_CERT_FILE: '/placeholder.pem',
    ELECTRON_RUN_AS_NODE: '1',
    SystemRoot: 'C:\\Windows',
    windir: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.COM;.EXE',
    NUMBER_OF_PROCESSORS: '4',
    USERPROFILE: 'C:\\Users\\placeholder',
    APPDATA: 'C:\\Users\\placeholder\\AppData\\Roaming',
  };
  const work = join('/Drashti data', 'Link downloads', 'youtube-placeholder');
  const folders = toolFolders(work);

  it('on a Mac: built from nothing, with Deno’s update check off and its cache in Drashti’s work folder', () => {
    expect(toolEnv(folders, 'darwin', USERS)).toEqual({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: join(work, 'temp'),
      LANG: 'en_US.UTF-8',
      HOME: join(work, 'home'),
      DENO_DIR: join(work, 'deno'),
      DENO_NO_UPDATE_CHECK: '1',
      DENO_NO_PROMPT: '1',
      DENO_NO_PACKAGE_JSON: '1',
      NO_COLOR: '1',
    });
  });

  it('on Windows: Windows’ own few, and the same', () => {
    const env = toolEnv(folders, 'win32', USERS);
    expect(env).toEqual({
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      PATHEXT: '.COM;.EXE',
      NUMBER_OF_PROCESSORS: '4',
      PATH: [join('C:\\Windows', 'System32'), 'C:\\Windows', join('C:\\Windows', 'System32', 'Wbem')].join(
        ';',
      ),
      USERPROFILE: join(work, 'home'),
      APPDATA: join(work, 'home', 'AppData', 'Roaming'),
      LOCALAPPDATA: join(work, 'home', 'AppData', 'Local'),
      TEMP: join(work, 'temp'),
      TMP: join(work, 'temp'),
      HOME: join(work, 'home'),
      DENO_DIR: join(work, 'deno'),
      DENO_NO_UPDATE_CHECK: '1',
      DENO_NO_PROMPT: '1',
      DENO_NO_PACKAGE_JSON: '1',
      NO_COLOR: '1',
    });
  });

  it('never carries the user’s DENO_*, NODE_*, PYTHON*, yt-dlp or proxy variables', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const keys = Object.keys(toolEnv(folders, platform, USERS));
      expect(keys.filter((k) => /^(NODE_|PYTHON|YTDLP|XDG_|SSL_|ELECTRON_)/u.test(k))).toEqual([]);
      expect(keys.filter((k) => /proxy/iu.test(k))).toEqual([]);
      expect(keys.filter((k) => k.startsWith('DENO_')).sort()).toEqual([
        'DENO_DIR',
        'DENO_NO_PACKAGE_JSON',
        'DENO_NO_PROMPT',
        'DENO_NO_UPDATE_CHECK',
      ]);
    }
  });
});

describe('which yt-dlp is started (the test guard)', () => {
  const place: LaunchPlace = {
    packaged: false,
    platform: 'darwin',
    testing: false,
    fake: null,
    fakeConfig: null,
    execPath: '/Electron',
    tools: { ytDlp: '/vendor/yt-dlp/yt-dlp_macos', deno: '/vendor/deno/deno' },
    ffmpeg: '/vendor/ffmpeg/ffmpeg',
  };
  const folders = toolFolders('/work');

  it('runs Drashti’s own yt-dlp, with Drashti’s own Deno and FFmpeg', () => {
    const r = youtubeLaunch(place, folders);
    expect(r.ok && r.launch).toEqual({
      command: '/vendor/yt-dlp/yt-dlp_macos',
      prefix: [],
      env: toolEnv(folders, 'darwin'),
      deno: '/vendor/deno/deno',
      ffmpeg: '/vendor/ffmpeg/ffmpeg',
    });
  });

  it('never starts the real yt-dlp with any test switch on: the fake when given, else nothing', () => {
    const none = youtubeLaunch({ ...place, testing: true }, folders);
    expect(none.ok).toBe(false);
    expect(none.ok ? '' : none.message).toMatch(/tests never start the real yt-dlp/u);
    const fake = youtubeLaunch(
      { ...place, testing: true, fake: '/tests/fake-yt-dlp.cjs', fakeConfig: '{}' },
      folders,
    );
    expect(fake.ok && fake.launch.command).toBe('/Electron');
    expect(fake.ok && fake.launch.prefix).toEqual(['/tests/fake-yt-dlp.cjs']);
    expect(fake.ok && fake.launch.env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(fake.ok && fake.launch.env['DRASHTI_FAKE_YT_DLP_CONFIG']).toBe('{}');
  });

  it('ignores the test switches in a packaged Drashti', () => {
    const r = youtubeLaunch(
      { ...place, packaged: true, testing: true, fake: '/tests/fake-yt-dlp.cjs' },
      folders,
    );
    expect(r.ok && r.launch.command).toBe('/vendor/yt-dlp/yt-dlp_macos');
    expect(r.ok && r.launch.prefix).toEqual([]);
  });

  it('says so when yt-dlp, Deno or FFmpeg is missing', () => {
    const tools = youtubeLaunch({ ...place, tools: null }, folders);
    expect(tools.ok ? '' : tools.message).toMatch(/copy of yt-dlp or Deno is missing/u);
    const ffmpeg = youtubeLaunch({ ...place, ffmpeg: null }, folders);
    expect(ffmpeg.ok ? '' : ffmpeg.message).toMatch(/copy of FFmpeg is missing/u);
  });
});

describe('reading yt-dlp’s answers', () => {
  it('reads progress lines, and nothing else', () => {
    expect(parseProgress(`${PROGRESS_MARK} 1000 4000 NA`)).toEqual({ done: 1000, total: 4000 });
    expect(parseProgress(`${PROGRESS_MARK} 1000 NA 9000.5`)).toEqual({ done: 1000, total: 9000.5 });
    expect(parseProgress(`${PROGRESS_MARK} 1000 NA NA`)).toEqual({ done: 1000, total: null });
    expect(parseProgress('[download] Destination: download.f137.mp4')).toBeNull();
    expect(parseProgress(`${PROGRESS_MARK} NA NA NA`)).toBeNull();
  });

  /** Made-up details, in yt-dlp's own shape. */
  const details = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: 'AAAAAAAAAAA',
      title: 'Placeholder video',
      duration: 100,
      live_status: 'not_live',
      formats: [
        { format_id: '137', height: 1080, vcodec: 'avc1.640028', acodec: 'none', filesize: 50_000_000 },
        { format_id: '248', height: 1080, vcodec: 'vp9', acodec: 'none', filesize: 40_000_000 },
        { format_id: '313', height: 2160, vcodec: 'vp9', acodec: 'none', filesize_approx: 300_000_000 },
        { format_id: '136', height: 720, vcodec: 'avc1.4d401f', acodec: 'none', tbr: 2000 },
        { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 1_600_000 },
        { format_id: '251', vcodec: 'none', acodec: 'opus', filesize: 1_700_000 },
        { format_id: 'sb0', vcodec: 'none', acodec: 'none', height: 90 },
      ],
      ...extra,
    });

  it('reads the title, the length, the heights tallest first and about how big each would be', () => {
    const r = parseDetails(details());
    expect(r.ok && r.details).toEqual({
      title: 'Placeholder video',
      duration: 100,
      heights: [
        { height: 2160, bytes: 300_000_000 + 1_600_000 },
        // H.264 at 1080p, as the download prefers it, with the AAC sound.
        { height: 1080, bytes: 50_000_000 + 1_600_000 },
        // Its bitrate over its length.
        { height: 720, bytes: 25_000_000 + 1_600_000 },
      ],
      soundBytes: Math.round((100 * 245_000) / 8),
    });
  });

  it('refuses a live stream still going, one not started, one just ended, and a playlist, in plain words', () => {
    const said = (json: string) => {
      const r = parseDetails(json);
      return r.ok ? '' : r.problem.message;
    };
    expect(said(details({ live_status: 'is_live' }))).toMatch(
      /live stream still going\. Download it after it ends/u,
    );
    expect(said(details({ live_status: 'is_upcoming' }))).toMatch(/has not started yet/u);
    expect(said(details({ live_status: 'post_live' }))).toMatch(/still getting it ready/u);
    expect(said(JSON.stringify({ _type: 'playlist', entries: [] }))).toMatch(/That is a playlist/u);
    expect(said('not JSON')).toMatch(/YouTube did not give this video/u);
  });

  it('turns yt-dlp’s errors into plain words with what to do next', () => {
    const code = (line: string) => youtubeProblem(line).code;
    expect(
      code('ERROR: [youtube] AAAAAAAAAAA: Sign in to confirm your age. This video may be inappropriate'),
    ).toBe('sign-in');
    expect(code('ERROR: [youtube] AAAAAAAAAAA: Private video. Sign in if you have been granted access')).toBe(
      'sign-in',
    );
    expect(
      code('ERROR: [youtube] AAAAAAAAAAA: Join this channel to get access to members-only content'),
    ).toBe('sign-in');
    expect(code('ERROR: [youtube] AAAAAAAAAAA: Sign in to confirm you’re not a bot')).toBe('not-a-robot');
    expect(
      code('ERROR: [youtube] AAAAAAAAAAA: The uploader has not made this video available in your country'),
    ).toBe('blocked');
    expect(
      code('ERROR: [youtube] AAAAAAAAAAA: Video unavailable. This video has been removed by the uploader'),
    ).toBe('removed');
    expect(
      code(
        'ERROR: [youtube] Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided',
      ),
    ).toBe('network');
    expect(
      code(
        'WARNING: [youtube] AAAAAAAAAAA: n challenge solving failed\nERROR: Requested format is not available',
      ),
    ).toBe('changed');
    expect(youtubeProblem('anything else').message).toMatch(/a newer Drashti may be needed/u);
    expect(youtubeProblem('Private video').message).toMatch(/never signs in to YouTube.*YouTube Studio/u);
    // Never yt-dlp's own words, which can name the video.
    for (const line of [
      'ERROR: [youtube] AAAAAAAAAAA: Private video',
      'ERROR: [youtube] AAAAAAAAAAA: Video unavailable',
    ])
      expect(youtubeProblem(line).message).not.toMatch(/AAAAAAAAAAA|ERROR|\[youtube\]/u);
  });
});
