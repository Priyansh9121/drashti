import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { captionClips, characterErrorRate, fakeMicrophoneFile, plainText, type PlacedClip } from './caption-clips';

/*
 * Caption AI's REAL recogniser inside Drashti (alpha.23, cap-realc; a22-review-cap S4). Every other caption test swaps
 * the engine for a stand-in (DRASHTI_TEST_SPEECH); this one never does. Route C (AI4Bharat's IndicConformer, CTC) comes
 * from alpha.22's real pack, imported as an admin does (Help › Caption and Translation Models… › Import a Zip…):
 * findIndic, the store's real acquire (every file's SHA-256 again), Drashti's helper with two threads below the show.
 * What it hears is generated speech (cap-winci's synthetic clips: never real speech, a recording or a microphone),
 * played by Chromium's fake microphone (DRASHTI_TEST_FAKE_SOUND_FILE, never in a packaged Drashti) as the stream's sound
 * input: the stream's own sound graph, its speech tap and its port to Main carry it, as they carry a mixer's feed.
 *
 * The pack is fetched by CI (scripts/fetch-caption-models.mjs, cap-winci; never in git or an installer); this spec only
 * reads the fetched copy, offline, and fails (never skips) where it is not there. The parts leave it out
 * (playwright.config.ts): CI runs it in a step of its own with DRASHTI_E2E_REAL_CAPTIONS=1 (ci.yml, "End-to-end and
 * installers"). Nothing here needs today's Whisper engine: Route C is the only recogniser this test asks for.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
/** The owner's live limit for a caption (x80): from the end of the speech to its settled phrase on a screen. */
const LIVE_LIMIT_MS = 3_000;
/** Silence before the first clip: the stream's frames are measured, then Route C starts listening, within it. */
const LEAD_MS = 15_000;
/** Silence after each clip, longer than the live limit: its phrase settles there, before the next clip begins. */
const GAP_MS = 4_000;
/**
 * A sanity bound on what is heard, not an accuracy measure (that is cap-eval's and cap-drive-eval's, on real speech):
 * cap-integration's in-chain run of synthetic Gujarati clips heard them at CER 0.03 median, 0.16 at most. A recogniser
 * fed the wrong rate, the wrong language or a broken sound path hears far worse.
 */
const CER_LIMIT = 0.25;

const ROUTES = [
  {
    language: 'gu',
    name: 'Gujarati',
    pack: 'pack-gu-indicconformer-int8',
    model: 'gu-indicconformer-ctc-int8',
  },
  {
    language: 'hi',
    name: 'Hindi',
    pack: 'pack-hi-indicconformer-int8',
    model: 'hi-indicconformer-ctc-int8',
  },
] as const;

/** The pack zip CI fetched (cap-winci's script, offline: it checks the cached copy and never downloads). */
function fetchedPack(id: string): string {
  const run = spawnSync(process.execPath, ['scripts/fetch-caption-models.mjs', '--offline', id], {
    encoding: 'utf8',
  });
  const line = run.stdout
    .split(/\r?\n/u)
    .find((l) => l.startsWith(`${id}=`))
    ?.slice(id.length + 1);
  if (run.status !== 0 || !line)
    throw new Error(
      `The real caption pack ${id} is not fetched on this computer: run node scripts/fetch-caption-models.mjs ${id} first (CI does). ${run.stderr.trim()}`,
    );
  return line;
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
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true, characterData: true });
    note();
  });
  return () =>
    p.evaluate(() => [...(globalThis as unknown as { drawnCaptions: { at: number; text: string }[] }).drawnCaptions]);
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

/** A window of frames as the frame meters read them: the gaps' 95th percentile, the longest, and those over 1.5 periods. */
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

/** Caption AI's phrases as the operator's review panel hears them (the panel shows each, for a correction). */
async function recordReview(win: Page): Promise<() => Promise<{ at: number; phraseId: string; status: string; text: string }[]>> {
  await win.evaluate(() => {
    const seen: { at: number; phraseId: string; status: string; text: string }[] = [];
    (globalThis as unknown as { reviewed: typeof seen }).reviewed = seen;
    (globalThis as PageGlobals).drashti.captions.onPrototypeChanged((review) => {
      const c = review.current;
      if (c) seen.push({ at: Date.now(), phraseId: c.phraseId, status: c.status, text: c.sourceText });
    });
  });
  return () =>
    win.evaluate(() => [
      ...(globalThis as unknown as { reviewed: { at: number; phraseId: string; status: string; text: string }[] })
        .reviewed,
    ]);
}

for (const route of ROUTES) {
  test(`caption AI's real Route C (${route.name}): generated speech through the stream's sound input reaches the hall, the stage and the stream within the live limit, the stream's frames as before, and the pack goes only after the helper has stopped`, async () => {
    test.setTimeout(300_000);
    const zip = fetchedPack(route.pack);
    const clips = captionClips(route.language);
    const folder = test.info().outputPath('fake-microphone');
    mkdirSync(folder, { recursive: true });
    const wav = join(folder, `${route.language}-clips.wav`);
    const placed: PlacedClip[] = fakeMicrophoneFile(wav, clips, { leadMs: LEAD_MS, gapMs: GAP_MS });
    const { app } = await launchApp({
      ...OUTPUTS,
      ...NO_PLACEHOLDERS,
      DRASHTI_TEST_FAKE_DEVICES: '1',
      DRASHTI_TEST_FAKE_SOUND_FILE: wav,
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const mainPid = await app.evaluate(() => process.pid);
      const places = await threePlaces(win, app);
      const watched = await Promise.all(
        [places.hall, places.stage, places.stream].map(async (page) => ({ page, drawn: await recordDrawn(page) })),
      );
      const frames = await recordFrames(places.stream);
      const reviewed = await recordReview(win);

      // The stream's profile: no camera, and no sound input yet (the fake microphone begins its file when opened).
      await expect
        .poll(async () =>
          win.evaluate(async () => (await (globalThis as PageGlobals).drashti.stream.status()).inputs.microphones.length),
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

      // The pack, as an admin imports it: the zip as downloaded.
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [f] });
      }, zip);
      await chooseMenuItem(app, 'model-packs');
      const packs = win.getByTestId('model-packs-dialog');
      await packs.getByTestId('model-packs-import-zip').click();
      await expect(packs.getByTestId('model-packs-notice')).toHaveText(
        /is installed on this computer, every file checked\.$/u,
        { timeout: 60_000 },
      );
      await packs.getByRole('button', { name: 'Close', exact: true }).click();
      const packView = () =>
        win.evaluate(async () => (await (globalThis as PageGlobals).drashti.modelPacks.view()).packs);
      const [pack] = await packView();
      expect(pack?.inUse).toBe(false);

      // The sound input on: the fake microphone's file begins no earlier than now (soundAskedAt) and no later than
      // the stream's page says its sound is on (soundOnAt).
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
      // The meters' first control: the stream with its sound input on, captions off.
      const controlFrom = Date.now();
      await letTimePass(win, 3_000, 'the stream’s frames with its sound input on and captions off (the control)');
      const controlTo = Date.now();

      // Caption AI on: the language's own model (from the pack), the speaker's language, captions on the hall too.
      await chooseMenuItem(app, 'live-captions');
      const dialog = win.getByTestId('captions-dialog');
      await dialog.getByTestId('captions-audience').click();
      await dialog.getByTestId(`captions-language-model-${route.language}-choice`).selectOption(route.model);
      await expect(dialog.getByTestId(`captions-language-model-${route.language}`)).toHaveAttribute(
        'data-phase',
        'ready',
      );
      await chooseMenuItem(app, `speaker-language-${route.language}`);
      await expect(dialog.getByTestId('captions-language')).toHaveValue(route.language);
      await dialog.getByTestId('captions-on').click();
      await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.', {
        timeout: 60_000,
      });
      const listeningAt = Date.now();
      const first = placed[0];
      if (!first) throw new Error('No clip');
      // Route C listened before the first clip's voice could begin (the file began at soundAskedAt at the earliest).
      expect(listeningAt + 1_000, 'listening a second before the first clip’s voice').toBeLessThan(
        soundAskedAt + first.speechStartMs,
      );

      // Route C itself: Drashti's helper, from its main process, two threads, below the show, holding the pack.
      await expect.poll(() => helperOf(mainPid), { timeout: 30_000 }).not.toBeNull();
      const helper = helperOf(mainPid);
      if (!helper) throw new Error('Route C’s helper stopped');
      expect(helper.args).toMatch(/--threads 2(?:\s|$)/u);
      expect(helper.below, `${helper.args}: below the show`).toBe(true);
      expect((await packView())[0]?.inUse).toBe(true);

      // Every clip heard: its phrase settled (the operator's review panel says so).
      const last = placed.at(-1) ?? first;
      await expect
        .poll(
          async () => {
            const settledAfter = (await reviewed()).filter(
              (r) => r.status === 'settled' && r.at >= soundAskedAt + last.speechStartMs,
            );
            return settledAfter.length > 0;
          },
          { timeout: LEAD_MS + last.endMs + GAP_MS + 30_000 },
        )
        .toBe(true);
      // Its last drawing a moment to reach the places (they draw a settled phrase within the live limit or fail).
      await letTimePass(win, LIVE_LIMIT_MS, 'the last settled phrase drawn on every place, or its limit passed');

      const review = await reviewed();
      const settled = new Map<string, { at: number; text: string }>();
      for (const r of review)
        if (r.status === 'settled' && !settled.has(r.phraseId)) settled.set(r.phraseId, { at: r.at, text: r.text });
      const phrases = [...settled.values()];
      const report: Record<string, unknown>[] = [];
      for (const [i, clip] of placed.entries()) {
        const next = placed[i + 1];
        // A phrase is this clip's when it settled after its voice began (the file at its earliest) and before the next's.
        const own = phrases.filter(
          (p) =>
            p.at >= soundAskedAt + clip.speechStartMs && (!next || p.at < soundAskedAt + next.speechStartMs),
        );
        expect(own.length, `${clip.id}: a settled phrase`).toBeGreaterThan(0);
        const heard = own.map((p) => p.text).join(' ');
        const cer = characterErrorRate(clip.text, heard);
        const finalText = own.at(-1)?.text ?? '';
        const row: Record<string, unknown> = { clip: clip.id, phrases: own.length, cer: Number(cer.toFixed(3)) };
        for (const [name, place] of [
          ['hall', watched[0]],
          ['stage', watched[1]],
          ['stream', watched[2]],
        ] as const) {
          if (!place) throw new Error(`No ${name} watched`);
          const shown = (await place.drawn()).find(
            (d) => d.at >= soundAskedAt + clip.startMs && plainText(d.text) === plainText(finalText),
          );
          expect(shown, `${clip.id}: its settled phrase on the ${name}`).toBeDefined();
          // From the end of its voice to its settled phrase on that place: the file began no earlier than
          // soundAskedAt, so this is never less than the truth; soundOnAt gives the least it could be.
          const latest = (shown?.at ?? 0) - (soundAskedAt + clip.speechEndMs);
          row[`${name}Ms`] = Math.round(latest);
          row[`${name}AtLeastMs`] = Math.round((shown?.at ?? 0) - (soundOnAt + clip.speechEndMs));
          expect(latest, `${clip.id} on the ${name}: within the live limit`).toBeLessThanOrEqual(LIVE_LIMIT_MS);
        }
        report.push(row);
        expect(cer, `${clip.id}: what was heard (CER)`).toBeLessThanOrEqual(CER_LIMIT);
      }

      // Off: the helper stops first, then the pack is let go (removable), never the other way round.
      await dialog.getByTestId('captions-on').click();
      for (const { page } of watched) await expect(page.getByTestId('captions')).toHaveCount(0);
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

      // The stream's own frames while Route C heard each clip, against the two controls with captions off: worse only
      // when every clip's window is worse than both controls (Q59-1).
      const all = await frames();
      const controls = [meter(all, controlFrom, controlTo), meter(all, offAt + 500, afterTo)];
      const trials = placed.map((clip) => {
        const own = phrases.filter((p) => p.at >= soundAskedAt + clip.speechStartMs);
        const settledAt = own[0]?.at ?? soundAskedAt + clip.endMs + GAP_MS;
        return meter(all, soundAskedAt + clip.speechStartMs, settledAt + 500, controls[0]?.period);
      });
      const worse = (t: ReturnType<typeof meter>, c: ReturnType<typeof meter>) =>
        t.p95 - c.p95 > 1 || t.longest - c.longest > 1 || t.over15 > c.over15;
      const allWorse = trials.every((t) => controls.every((c) => worse(t, c)));
      await test.info().attach('caption-ai-real.json', {
        body: JSON.stringify(
          { route: route.model, soundOnAfterMs: soundOnAt - soundAskedAt, listeningAt: listeningAt - soundAskedAt, clips: report, controls, trials },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      for (const c of controls) expect(c.frames, 'a control window drew').toBeGreaterThan(30);
      expect(allWorse, 'the stream’s frames while Route C heard the clips, no worse than with captions off').toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });
}
