import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  chooseMenuItem,
  launchApp,
  letTimePass,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { plainText, type PlacedSound } from './caption-clips';

/*
 * Route C inside Drashti (alpha.23, cap-realc; a22-review-cap S4), with no stand-in engine (no DRASHTI_TEST_SPEECH):
 * the pack imported as an admin does (Help › Caption and Translation Models…), findIndic, the store's real acquire
 * (every file's SHA-256 again), Drashti's helper with two threads below the show, caption AI's flow and coordinator,
 * and the hall, the stage and the stream drawing each settled phrase. What it hears is the stream's sound input:
 * Chromium's fake microphone playing one generated WAV file (DRASHTI_TEST_FAKE_SOUND_FILE, never in a packaged
 * Drashti), through the stream's own sound graph, its speech tap and its port to Main, as a mixer's feed is heard.
 * caption-ai-chain.spec.ts runs it with the generated test model; caption-ai-real.spec.ts with alpha.22's real packs.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
/** The owner's live limit for a caption (x80): from the end of the speech to its settled phrase on a screen. */
export const LIVE_LIMIT_MS = 3_000;

export interface RouteCInApp {
  /** The attachment's name (times, frame meters and checks; ids and numbers, never words). */
  name: string;
  language: 'gu' | 'hi';
  /** The language's own model as Live Captions lists it. */
  model: string;
  /** Launch switches beyond the fake microphone's (the generated model's known list). */
  env?: Record<string, string>;
  /** The pack as an admin brings it in: a zip as downloaded, or a folder. */
  pack: { kind: 'zip' | 'folder'; path: string };
  /** The fake microphone's file (absolute) and the sounds in it, each `leadMs` / `gapMs` apart. */
  wav: string;
  sounds: readonly PlacedSound[];
  leadMs: number;
  gapMs: number;
  /** Whether what was heard of a sound (its settled phrases joined) is right, and its numbers for the report. */
  heard: (sound: PlacedSound, heard: string) => { ok: boolean; numbers: Record<string, unknown> };
}

interface Helper {
  pid: number;
  args: string;
  /** Below the show: the Mac's background band (taskpolicy -b: priority 4), or Windows' below normal. */
  below: boolean;
}

/** Route C's helper, started by Drashti's main process (its child), or null. */
function helperOf(mainPid: number): Helper | null {
  if (process.platform === 'win32') {
    const ps = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const out = execFileSync(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(mainPid)} AND Name='ic-ctc.exe'" | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; '{0}|{1}|{2}' -f $_.ProcessId, $p.PriorityClass, $_.CommandLine }`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const [pid = '', priority = '', ...args] = out.trim().split(/\r?\n/u)[0]?.split('|') ?? [];
    return pid
      ? { pid: Number(pid), args: args.join('|'), below: ['BelowNormal', 'Idle'].includes(priority.trim()) }
      : null;
  }
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pri=,args='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  for (const row of rows.split('\n')) {
    const [pid = '', ppid = '', pri = '', ...args] = row.trim().split(/\s+/u);
    if (Number(ppid) === mainPid && /[\\/]ic-ctc(?:\s|$)/u.test(`${args.join(' ')} `))
      return { pid: Number(pid), args: args.join(' '), below: Number(pri) <= 4 };
  }
  return null;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const outputWith = async (app: ElectronApplication, role: string): Promise<Page> => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall (captions shown there too), the stage and the stream's page, each ready to draw. */
async function threePlaces(win: Page, app: ElectronApplication) {
  await setUpScreen(win, 'Main Hall', 0);
  const stageId = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stageId);
  await expect
    .poll(async () => (await Promise.all(outputPages(app).map(roleOf))).sort())
    .toEqual(['audience', 'stage']);
  await win.getByTestId('open-stream').click();
  const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  const places = { hall: await outputWith(app, 'audience'), stage: await outputWith(app, 'stage'), stream };
  for (const [page, root] of [
    [places.hall, 'output-root'],
    [places.stage, 'output-root'],
    [places.stream, 'program-root'],
  ] as const) {
    await expect(page.getByTestId(root)).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
    await expect(page.getByTestId(root)).not.toHaveAttribute('data-warm-up', 'warming', { timeout: 30_000 });
  }
  return places;
}

interface Drawn {
  at: number;
  text: string;
}

/** Every caption a place draws from now on, with this computer's clock (ms) as it was drawn, kept by the page. */
async function recordDrawn(p: Page): Promise<() => Promise<Drawn[]>> {
  await p.evaluate(() => {
    const seen: { at: number; text: string }[] = [];
    (globalThis as unknown as { drawnCaptions: typeof seen }).drawnCaptions = seen;
    const note = (): void => {
      const text = [...document.querySelectorAll('[data-testid="captions"] > div > div')]
        .map((l) => l.textContent)
        .join(' ');
      if (seen.at(-1)?.text !== text) seen.push({ at: Date.now(), text });
    };
    new MutationObserver(note).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    note();
  });
  return () =>
    p.evaluate(() => [
      ...(globalThis as unknown as { drawnCaptions: { at: number; text: string }[] }).drawnCaptions,
    ]);
}

/** The stream's page's frames from now on (this computer's clock, ms), as the page draws them. */
async function recordFrames(p: Page): Promise<() => Promise<number[]>> {
  await p.evaluate(() => {
    const times: number[] = [];
    (globalThis as unknown as { streamFrames: number[] }).streamFrames = times;
    const frame = (now: number): void => {
      times.push(performance.timeOrigin + now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  return () => p.evaluate(() => [...(globalThis as unknown as { streamFrames: number[] }).streamFrames]);
}

/**
 * The stream's sound level as its page reports it (body data-level: the loudest of each 100 ms, dBFS), with this
 * computer's clock: when each sound reached the stream's sound graph, and for how long it was loud there.
 */
async function recordLevels(p: Page): Promise<() => Promise<{ at: number; db: number }[]>> {
  await p.evaluate(() => {
    const seen: { at: number; db: number }[] = [];
    (globalThis as unknown as { streamLevels: typeof seen }).streamLevels = seen;
    new MutationObserver(() => {
      seen.push({ at: Date.now(), db: Number(document.body.dataset['level'] ?? '-100') });
    }).observe(document.body, { attributes: true, attributeFilter: ['data-level'] });
  });
  return () =>
    p.evaluate(() => [
      ...(globalThis as unknown as { streamLevels: { at: number; db: number }[] }).streamLevels,
    ]);
}

/**
 * Where a sound was loud in the stream's sound graph (over -45 dBFS), between `from` and `to` (this computer's clock):
 * its first and last loud report, and how many 100 ms reports were loud. Null when it never was.
 */
function loudSpan(levels: readonly { at: number; db: number }[], from: number, to: number) {
  const loud = levels.filter((l) => l.at >= from && l.at <= to && l.db > -45);
  const first = loud[0];
  const last = loud.at(-1);
  return first && last ? { first: first.at, last: last.at, reports: loud.length } : null;
}

/** A window of frames as the frame meters read them: the gaps' 95th percentile, the longest, those over 1.5 periods. */
function meter(frames: readonly number[], from: number, to: number, period?: number) {
  const inside = frames.filter((t) => t >= from && t <= to);
  const gaps = inside.slice(1).map((t, i) => t - (inside[i] ?? t));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = period ?? sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    frames: inside.length,
    period: median,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    longest: sorted.at(-1) ?? 0,
    over15: gaps.filter((g) => g > median * 1.5).length,
  };
}

interface Reviewed {
  at: number;
  phraseId: string;
  status: string;
  text: string;
  /** Where the recogniser put the phrase's end, on the main process's own clock (performance.now there). */
  endAt: number;
}

/** Caption AI's phrases as the operator's review panel hears them (the panel shows each, for a correction). */
async function recordReview(win: Page): Promise<() => Promise<Reviewed[]>> {
  await win.evaluate(() => {
    const seen: { at: number; phraseId: string; status: string; text: string; endAt: number }[] = [];
    (globalThis as unknown as { reviewed: typeof seen }).reviewed = seen;
    (globalThis as PageGlobals).drashti.captions.onPrototypeChanged((review) => {
      const c = review.current;
      if (c)
        seen.push({
          at: Date.now(),
          phraseId: c.phraseId,
          status: c.status,
          text: c.sourceText,
          endAt: c.endAt,
        });
    });
  });
  return () =>
    win.evaluate(() => [
      ...(
        globalThis as unknown as {
          reviewed: { at: number; phraseId: string; status: string; text: string; endAt: number }[];
        }
      ).reviewed,
    ]);
}

/**
 * The run: each sound's settled phrase on the hall, the stage and the stream within the live limit of its end, nothing
 * heard in the file's silence before it, the helper as the app starts it, the stream's frames no worse than with
 * captions off, and the pack let go only once the helper has stopped.
 */
export async function routeCInTheApp(o: RouteCInApp): Promise<void> {
  const first = o.sounds[0];
  const last = o.sounds.at(-1);
  if (!first || !last) throw new Error('No sound in the fake microphone’s file');
  const { app } = await launchApp({
    ...OUTPUTS,
    ...NO_PLACEHOLDERS,
    ...o.env,
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_TEST_FAKE_SOUND_FILE: o.wav,
  });
  // The run's numbers (times, counts, frame meters and ids, never words), in the CI log and attached, as far as the
  // run got: written again as each part is known, so a failure keeps them (S3).
  const started = Date.now();
  const summary: Record<string, unknown> = { model: o.model };
  const say = async (): Promise<void> => {
    console.log(`${o.name}: ${JSON.stringify(summary)}`);
    await test.info().attach(`${o.name}.json`, {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });
  };
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const mainPid = await app.evaluate(() => process.pid);
    const places = await threePlaces(win, app);
    const watched = [
      ['hall', await recordDrawn(places.hall)],
      ['stage', await recordDrawn(places.stage)],
      ['stream', await recordDrawn(places.stream)],
    ] as const;
    const frames = await recordFrames(places.stream);
    const levels = await recordLevels(places.stream);
    const reviewed = await recordReview(win);

    // The stream's profile: no camera, and no sound input yet (the fake microphone begins its file when opened).
    await expect
      .poll(async () =>
        win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.stream.status()).inputs.microphones.length,
        ),
      )
      .toBeGreaterThan(0);
    const saveSound = (withSound: boolean) =>
      win.evaluate(async (withSound) => {
        const d = (globalThis as PageGlobals).drashti;
        const s = await d.stream.status();
        const { profiles, activeId } = await d.stream.profiles();
        const p = profiles.find((x) => x.id === activeId);
        if (!p) return 'no profile';
        const saved = await d.stream.saveProfile(p.id, {
          name: 'Local test',
          url: 'rtmp://127.0.0.1:1/live2',
          preset: 'weak',
          camera: null,
          sound: withSound ? (s.inputs.microphones[0] ?? null) : null,
          soundDelayMs: 0,
          mixOwnSound: false,
        });
        return saved.ok ? 'ok' : saved.message;
      }, withSound);
    expect(await saveSound(false)).toBe('ok');

    // The pack, as an admin brings it in.
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
    }, o.pack.path);
    await chooseMenuItem(app, 'model-packs');
    const packs = win.getByTestId('model-packs-dialog');
    await packs.getByTestId(`model-packs-import-${o.pack.kind}`).click();
    await expect(packs.getByTestId('model-packs-notice')).toHaveText(
      /is installed on this computer, every file checked\.$/u,
      { timeout: 60_000 },
    );
    await packs.getByRole('button', { name: 'Close', exact: true }).click();
    const packView = () =>
      win.evaluate(async () => (await (globalThis as PageGlobals).drashti.modelPacks.view()).packs);
    const [pack] = await packView();
    expect(pack?.inUse).toBe(false);

    // The sound input on: the fake microphone's file begins no earlier than now (soundAskedAt) and no later than the
    // stream's page says its sound is on (soundOnAt).
    await places.stream.evaluate(() => {
      const root = document.querySelector('[data-testid="program-root"]');
      const g = globalThis as unknown as { soundOnAt?: number };
      new MutationObserver(() => {
        if (root?.getAttribute('data-sound') === 'on') g.soundOnAt ??= Date.now();
      }).observe(root ?? document.body, { attributes: true, attributeFilter: ['data-sound'] });
    });
    const soundAskedAt = Date.now();
    expect(await saveSound(true)).toBe('ok');
    await expect(places.stream.getByTestId('program-root')).toHaveAttribute('data-sound', 'on');
    const soundOnAt = await places.stream.evaluate(
      () => (globalThis as unknown as { soundOnAt?: number }).soundOnAt ?? Date.now(),
    );
    // The frame meters' first control: the stream with its sound input on, captions off.
    const controlFrom = Date.now();
    await letTimePass(
      win,
      3_000,
      'the stream’s frames with its sound input on and captions off (the control)',
    );
    const controlTo = Date.now();

    // Caption AI on: the language's own model (from the pack), the speaker's language, captions on the hall too.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-audience').click();
    await dialog.getByTestId(`captions-language-model-${o.language}-choice`).selectOption(o.model);
    await expect(dialog.getByTestId(`captions-language-model-${o.language}`)).toHaveAttribute(
      'data-phase',
      'ready',
    );
    await chooseMenuItem(app, `speaker-language-${o.language}`);
    await expect(dialog.getByTestId('captions-language')).toHaveValue(o.language);
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.', {
      timeout: 60_000,
    });
    const listeningAt = Date.now();
    summary['soundOnAfterMs'] = soundOnAt - soundAskedAt;
    summary['listeningAfterMs'] = listeningAt - soundAskedAt;
    // Route C listened a second before the first sound could begin (the file began at soundAskedAt at the earliest).
    expect(listeningAt + 1_000, 'listening a second before the first sound').toBeLessThan(
      soundAskedAt + first.speechStartMs,
    );

    // Route C itself: Drashti's helper, from its main process, two threads, below the show, holding the pack.
    await expect.poll(() => helperOf(mainPid), { timeout: 30_000 }).not.toBeNull();
    const helper = helperOf(mainPid);
    if (!helper) throw new Error('Route C’s helper stopped');
    expect(helper.args).toMatch(/--threads 2(?:\s|$)/u);
    expect(helper.below, `${helper.args}: below the show`).toBe(true);
    expect((await packView())[0]?.inUse).toBe(true);

    // Every sound heard: its phrase settled (the operator's review panel says so).
    await expect
      .poll(
        async () =>
          (await reviewed()).some((r) => r.status === 'settled' && r.at >= soundAskedAt + last.speechStartMs),
        { timeout: last.endMs + o.gapMs + 30_000 },
      )
      .toBe(true);
    // The last one a moment to reach the places (each draws a settled phrase within the live limit, or fails).
    await letTimePass(
      win,
      LIVE_LIMIT_MS,
      'the last settled phrase drawn on every place, or its limit passed',
    );

    const review = await reviewed();
    summary['reviewed'] = review.length;
    summary['heardBeforeFirstSound'] = review.filter((r) => r.at < soundAskedAt + first.speechStartMs).length;
    // Nothing heard in the file's silence before its first sound: a beep, or a sound other than the file, would be.
    expect(
      review.filter((r) => r.at < soundAskedAt + first.speechStartMs).length,
      'nothing heard before the file’s first sound',
    ).toBe(0);
    // The main process's clock against this computer's (its performance.now() is what the coordinator keeps).
    const mainOffset = await app.evaluate(() => Date.now() - performance.now());
    const settled = new Map<string, { at: number; text: string; endAt: number }>();
    for (const r of review)
      if (r.status === 'settled' && !settled.has(r.phraseId))
        settled.set(r.phraseId, { at: r.at, text: r.text, endAt: r.endAt + mainOffset });
    const phrases = [...settled.values()];
    // Every sound's numbers first (S3: kept even when one fails), then its checks.
    const report: Record<string, unknown>[] = [];
    const checks: {
      sound: string;
      phrases: number;
      heardOk: boolean;
      shown: Record<string, number | null>;
    }[] = [];
    for (const [i, sound] of o.sounds.entries()) {
      const next = o.sounds[i + 1];
      // A phrase is this sound's when it settled after the sound began (the file at its earliest) and before the next.
      const own = phrases.filter(
        (p) =>
          p.at >= soundAskedAt + sound.speechStartMs && (!next || p.at < soundAskedAt + next.speechStartMs),
      );
      const finalText = own.at(-1)?.text ?? '';
      const heard = own.length
        ? o.heard(sound, own.map((p) => p.text).join(' '))
        : { ok: false, numbers: {} };
      const row: Record<string, unknown> = { sound: sound.id, phrases: own.length, ...heard.numbers };
      const shown: Record<string, number | null> = {};
      for (const [name, drawn] of watched) {
        // The words of its settled phrase on that place (the first time they were drawn after the sound began).
        const at = own.length
          ? ((await drawn()).find(
              (d) => d.at >= soundAskedAt + sound.startMs && plainText(d.text) === plainText(finalText),
            )?.at ?? null)
          : null;
        // From the end of the sound to its words on that place: the file began no earlier than soundAskedAt, so this
        // is never less than the truth; soundOnAt gives the least it could be.
        shown[name] = at === null ? null : at - (soundAskedAt + sound.speechEndMs);
        row[`${name}Ms`] = at === null ? null : Math.round(at - (soundAskedAt + sound.speechEndMs));
        row[`${name}AtLeastMs`] = at === null ? null : Math.round(at - (soundOnAt + sound.speechEndMs));
      }
      // When the sound itself reached the stream's sound graph, against when the file holds it (the file at its
      // earliest): a fake microphone late or slow on a busy computer shows here, apart from the recogniser.
      const heardLevels = loudSpan(
        await levels(),
        soundAskedAt + sound.startMs - 500,
        next ? soundAskedAt + next.startMs - 500 : soundAskedAt + sound.endMs + o.gapMs,
      );
      row['arrivedLateMs'] = heardLevels
        ? Math.round(heardLevels.first - (soundAskedAt + sound.speechStartMs))
        : null;
      row['loudForMs'] = heardLevels ? Math.round(heardLevels.last - heardLevels.first) : null;
      row['voiceMs'] = Math.round(sound.speechEndMs - sound.speechStartMs);
      // The recogniser's own view: how late it put the speech's end against the file (a late sound input shows here
      // too), and how long after that end the phrase settled (its pause, its decoding and the way to the screens).
      const lastOwn = own.at(-1);
      row['endLateMs'] = lastOwn ? Math.round(lastOwn.endAt - (soundAskedAt + sound.speechEndMs)) : null;
      row['settledAfterEndMs'] = lastOwn ? Math.round(lastOwn.at - lastOwn.endAt) : null;
      // What was heard, only when it was wrong: generated placeholder sentences (cap-winci's), never real speech.
      if (!heard.ok) row['heard'] = own.map((p) => p.text).join(' ');
      report.push(row);
      checks.push({ sound: sound.id, phrases: own.length, heardOk: heard.ok, shown });
    }
    summary['sounds'] = report;
    await say();
    for (const c of checks) {
      expect(c.phrases, `${c.sound}: a settled phrase`).toBeGreaterThan(0);
      expect(c.heardOk, `${c.sound}: what was heard`).toBe(true);
      for (const [name, latest] of Object.entries(c.shown)) {
        expect(latest, `${c.sound}: its settled phrase on the ${name}`).not.toBeNull();
        expect(latest ?? Infinity, `${c.sound} on the ${name}: within the live limit`).toBeLessThanOrEqual(
          LIVE_LIMIT_MS,
        );
      }
    }

    // Off: the helper stops first, then the pack is let go (removable), never the other way round.
    await dialog.getByTestId('captions-on').click();
    for (const p of [places.hall, places.stage, places.stream])
      await expect(p.getByTestId('captions')).toHaveCount(0);
    const offAt = Date.now();
    // Asked every 25 ms: the first answer that the pack is let go, with whether the helper still ran just then.
    let letGoWhileRunning: boolean | null = null;
    await expect
      .poll(
        async () => {
          const inUse = (await packView())[0]?.inUse;
          if (inUse === false) letGoWhileRunning ??= alive(helper.pid);
          return inUse;
        },
        { timeout: 15_000, intervals: [25] },
      )
      .toBe(false);
    expect(letGoWhileRunning, 'the pack let go only once Route C’s helper had stopped').toBe(false);
    expect(alive(helper.pid)).toBe(false);
    await letTimePass(win, 3_000, 'the stream’s frames with captions off again (the second control)');
    const afterTo = Date.now();
    const removed = await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.modelPacks.remove(id)).ok,
      pack?.id ?? '',
    );
    expect(removed, 'the pack removed at once (Windows: no file of it still open)').toBe(true);

    // The stream's own frames while Route C heard each sound, against the two controls with captions off (lead 2's
    // QR-1 A): worse only when every sound's window is worse than both controls (Q59-1).
    const all = await frames();
    const controls = [meter(all, controlFrom, controlTo), meter(all, offAt + 500, afterTo)];
    const trials = o.sounds.map((sound) => {
      const own = phrases.filter((p) => p.at >= soundAskedAt + sound.speechStartMs);
      const settledAt = own[0]?.at ?? soundAskedAt + sound.endMs + o.gapMs;
      return meter(all, soundAskedAt + sound.speechStartMs, settledAt + 500, controls[0]?.period);
    });
    const worse = (t: ReturnType<typeof meter>, c: ReturnType<typeof meter>) =>
      t.p95 - c.p95 > 1 || t.longest - c.longest > 1 || t.over15 > c.over15;
    summary['controls'] = controls;
    summary['trials'] = trials;
    await say();
    for (const c of controls) expect(c.frames, 'a control window drew').toBeGreaterThan(30);
    expect(
      trials.every((t) => controls.every((c) => worse(t, c))),
      'the stream’s frames while Route C heard the sounds, no worse than with captions off',
    ).toBe(false);
  } catch (e) {
    summary['failedAfterMs'] = Date.now() - started;
    await say();
    throw e;
  } finally {
    await app.close();
  }
}
