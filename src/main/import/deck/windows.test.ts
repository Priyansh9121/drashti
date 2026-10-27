import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  convertToPdf,
  deckOnWindows,
  POWERPOINT_WINDOWS_BAKE_SCRIPT,
  POWERPOINT_WINDOWS_PUT_BACK_SCRIPT,
  POWERPOINT_WINDOWS_SCRIPT,
  POWERPOINT_WINDOWS_SHOWN_SCRIPT,
  type PowerShellRunner,
  type Ran,
} from '../deck-converters';

/*
 * PowerPoint on Windows making a deck's movie (Session 54, C2), from Microsoft's documentation: CI has no Office,
 * so the script is read here, and what Drashti does with it is tried with a stand-in for PowerShell that answers
 * as PowerPoint would (the mandir PC tries it for real: assister/session-54-deck-trial.md).
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-windows-deck-'));
/** Processes standing in for a PowerPoint Drashti started (stopped at the end, whatever the test did). */
const standIns: ChildProcess[] = [];
afterAll(() => {
  for (const child of standIns) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

/** A process that waits, standing in for PowerPoint: its id, and whether it ends within `ms`. */
function standInPowerPoint(): { pid: number; ended: (ms?: number) => Promise<boolean> } {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  standIns.push(child);
  let gone = false;
  child.on('exit', () => {
    gone = true;
  });
  return {
    pid: child.pid ?? 0,
    ended: async (ms = 5000) => {
      for (let waited = 0; !gone && waited < ms; waited += 50) await new Promise((r) => setTimeout(r, 50));
      return gone;
    },
  };
}

const ran = (over: Partial<Ran> = {}): Promise<Ran> =>
  Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false, ...over });

describe('the PowerPoint script for a deck’s movie', () => {
  const script = POWERPOINT_WINDOWS_BAKE_SCRIPT;
  const at = (text: string) => script.indexOf(text);

  it('forces macros off before it opens the deck, and puts them back in finally', () => {
    expect(at('$app.AutomationSecurity = 3')).toBeGreaterThan(at('$security = $app.AutomationSecurity'));
    expect(at('$app.AutomationSecurity = 3')).toBeLessThan(at('$app.Presentations.Open('));
    expect(script).not.toMatch(/try \{ \$app\.AutomationSecurity = 3 \} catch/u);
    expect(script.slice(at('} finally {'))).toContain('$app.AutomationSecurity = $security');
  });

  it('opens the copy read-only without a window, and saves an old .ppt as a .pptx (24) and the pictures as PDF (32)', () => {
    // Presentations.Open(FileName, ReadOnly msoTrue, Untitled msoFalse, WithWindow msoFalse).
    expect(script).toContain('$app.Presentations.Open($In, -1, 0, 0)');
    expect(script).toContain('$pres.SaveAs($Pptx, 24)');
    expect(script).toContain('$pres.SaveAs($Pdf, 32)');
  });

  it('makes the movie with the copy’s own timings at 1080 lines, 30 frames a second, and waits for it in time', () => {
    // CreateVideo(FileName, UseTimingsAndNarrations, DefaultSlideDuration, VertResolution, FramesPerSecond, Quality).
    expect(script).toContain('$pres.CreateVideo($Movie, $true, 5, 1080, 30, 85)');
    const wait = script.slice(at('$pres.CreateVideo('));
    // Done is 3 (ppMediaTaskStatusDone), failed 4; 1 in progress and 2 queued are waited for, up to the limit.
    expect(wait).toContain('$pres.CreateVideoStatus');
    expect(wait).toContain('if ($status -eq 3) { break }');
    expect(wait).toMatch(/if \(\$status -eq 4\) \{ throw /u);
    expect(wait).toContain('$deadline = (Get-Date).AddSeconds($LimitSeconds)');
    expect(at('$pres.CreateVideo(')).toBeLessThan(at('} finally {'));
  });

  it('gives up on a movie that has made no progress for the time given: the same size, and PowerPoint’s processor time up by less than it takes to work (Session 54, C review)', () => {
    expect(script).toContain('[int]$StallSeconds = 0, [int]$WorkingMs = 500');
    const wait = script.slice(at('$pres.CreateVideo('), at('} finally {'));
    // PowerPoint's own processor time, read afresh each time; when it cannot be read, only the time limit counts.
    expect(wait).toContain('$ppt.Refresh(); $ppt.TotalProcessorTime.TotalMilliseconds');
    expect(wait).toContain('(Get-Item -LiteralPath $Movie).Length');
    expect(wait).toContain('$now - $markCpu -ge $WorkingMs');
    expect(wait).toMatch(
      /if \(\$StallSeconds -gt 0 -and \$null -ne \$markCpu -and \(\(Get-Date\) - \$moved\)\.TotalSeconds -gt \$StallSeconds\) \{ throw 'PowerPoint made no progress on the movie for a minute\.' \}/u,
    );
  });

  it('writes down the PowerPoint it started, below normal priority, and quits it only when nothing else is open or shows', () => {
    expect(at('Set-Content -LiteralPath $Started')).toBeLessThan(at('$app.Presentations.Open('));
    expect(script).toContain("PriorityClass = 'BelowNormal'");
    // A window shows: the operator opened PowerPoint (or something in it) meanwhile (Session 54, C review).
    expect(script).toContain('MainWindowHandle -ne [IntPtr]::Zero');
    expect(script).toContain(
      'if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0 -and $shown.Count -eq 0) { $app.Quit() }',
    );
  });
});

describe('the PowerPoint script for saving a deck as PDF (Session 54, C review)', () => {
  it('quits the PowerPoint it started only when nothing else is open or shows', () => {
    expect(POWERPOINT_WINDOWS_SCRIPT).toContain('MainWindowHandle -ne [IntPtr]::Zero');
    expect(POWERPOINT_WINDOWS_SCRIPT).toContain(
      'if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0 -and $shown.Count -eq 0) { $app.Quit() }',
    );
  });
});

describe('a PowerPoint that does not finish is stopped only while it shows no window (Session 54, C review)', () => {
  const deck = join(dir, 'Placeholder stuck deck.pptx');
  writeFileSync(deck, 'placeholder deck bytes');

  /** PowerShell as a stuck PowerPoint leaves it: `script` stuck after writing down `ids`; `shown` show a window. */
  function stuck(
    script: string,
    ids: number[],
    shown: Ran | number[],
    asked: string[] = [],
  ): PowerShellRunner {
    return (file, args) => {
      const text = readFileSync(file, 'utf8');
      const a = named(args);
      if (text === script) {
        writeFileSync(a['Started'] ?? '', ids.join(','));
        return ran({ code: null, timedOut: true });
      }
      if (text === POWERPOINT_WINDOWS_SHOWN_SCRIPT) {
        asked.push(a['Ids'] ?? '');
        return Array.isArray(shown) ? ran({ stdout: `${shown.join(',')}\r\n` }) : Promise.resolve(shown);
      }
      return ran();
    };
  }

  it('making a movie: the one with no window is stopped; one showing a window is left open and said so', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const hidden = standInPowerPoint();
    const shown = standInPowerPoint();
    const asked: string[] = [];
    const ended: number[] = [];
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuck(POWERPOINT_WINDOWS_BAKE_SCRIPT, [hidden.pid, shown.pid], [shown.pid], asked),
      ended: (pid) => ended.push(pid),
    });
    expect(asked).toEqual([`${String(hidden.pid)},${String(shown.pid)}`]);
    expect(await hidden.ended()).toBe(true);
    expect(await shown.ended(300)).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: 'PowerPoint stopped answering' });
    expect(r.ok ? '' : r.message).toContain(
      'PowerPoint shows a window now (opened meanwhile), so Drashti left it open: look at PowerPoint.',
    );
    // Either way no longer Drashti's own.
    expect(ended.sort()).toEqual([hidden.pid, shown.pid].sort());
  });

  it('saving as PDF: the same', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const hidden = standInPowerPoint();
    const shown = standInPowerPoint();
    const r = await convertToPdf('powerpoint', deck, work, {
      platform: 'win32',
      runPowerShell: stuck(POWERPOINT_WINDOWS_SCRIPT, [hidden.pid, shown.pid], [shown.pid]),
    });
    expect(await hidden.ended()).toBe(true);
    expect(await shown.ended(300)).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: 'PowerPoint stopped answering' });
    expect(r.ok ? '' : r.message).toContain('so Drashti left it open: look at PowerPoint.');
  });

  it('stops nothing when it cannot be told whether a window shows', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const one = standInPowerPoint();
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuck(POWERPOINT_WINDOWS_BAKE_SCRIPT, [one.pid], {
        code: null,
        stdout: '',
        stderr: '',
        timedOut: true,
        aborted: false,
      }),
    });
    expect(await one.ended(300)).toBe(false);
    expect(r.ok ? '' : r.message).toContain('so Drashti left it open');
  });

  it('stops the one it started when no window shows, as before', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const one = standInPowerPoint();
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuck(POWERPOINT_WINDOWS_BAKE_SCRIPT, [one.pid], []),
    });
    expect(await one.ended()).toBe(true);
    expect(r.ok ? '' : r.message).not.toContain('left it open');
  });
});

/** Arguments as the script receives them, by name. */
function named(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < args.length; i += 2) out[(args[i] ?? '').replace(/^-/u, '')] = args[i + 1] ?? '';
  return out;
}

describe('PowerPoint on Windows, with a stand-in for PowerShell', () => {
  const deck = join(dir, 'Placeholder deck.pptx');
  writeFileSync(deck, 'placeholder deck bytes');

  it('asks for the movie and the pictures of a copy, and tells which PowerPoint it started and when it ended', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const seen: Record<string, string>[] = [];
    const started: number[] = [];
    const ended: number[] = [];
    const fake: PowerShellRunner = (script, args, timeoutMs) => {
      const a = named(args);
      seen.push({ ...a, timeoutMs: String(timeoutMs) });
      expect(readFileSync(script, 'utf8')).toBe(POWERPOINT_WINDOWS_BAKE_SCRIPT);
      // A copy, never the operator's file.
      expect(a['In']).not.toBe(deck);
      expect(readFileSync(a['In'] ?? '', 'utf8')).toBe('placeholder deck bytes');
      writeFileSync(a['Started'] ?? '', '4242,4343');
      writeFileSync(a['Movie'] ?? '', 'movie');
      writeFileSync(a['Pdf'] ?? '', 'pdf');
      return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false });
    };
    const movie = join(work, 'movie.mp4');
    const r = await deckOnWindows(
      { input: deck, pdf: join(work, 'pictures.pdf'), movie, movieLimitMs: 300_000, stallMs: 60_000 },
      work,
      {
        runPowerShell: fake,
        slideCount: 6,
        started: (pid) => started.push(pid),
        ended: (pid) => ended.push(pid),
      },
    );
    expect(r).toEqual({ ok: true });
    expect(seen[0]?.['LimitSeconds']).toBe('300');
    // No progress for a minute: given up on (Session 54, C review).
    expect(seen[0]?.['StallSeconds']).toBe('60');
    expect(seen[0]?.['Pptx']).toBeUndefined();
    expect(Number(seen[0]?.['timeoutMs'])).toBeGreaterThan(300_000);
    expect(started).toEqual([4242, 4343]);
    expect(ended).toEqual([4242, 4343]);
    // The copy is gone afterwards.
    expect(existsSync(seen[0]?.['In'] ?? '')).toBe(false);
  });

  it('says plainly when PowerPoint could not make the movie, its own words kept for the log', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const log: string[] = [];
    const fake: PowerShellRunner = (_script, args) => {
      writeFileSync(named(args)['Started'] ?? '', '');
      return Promise.resolve({
        code: 1,
        stdout: '',
        stderr: 'PowerPoint could not make the movie.\nAt line:30 char:5',
        timedOut: false,
        aborted: false,
      });
    };
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: fake,
      log: (line) => log.push(line),
    });
    expect(r).toMatchObject({ ok: false, reason: 'it could not make the movie' });
    expect(r.ok ? '' : r.message).toBe('PowerPoint could not make the deck’s movie.');
    expect(log).toEqual(['PowerPoint: failed: PowerPoint could not make the movie.']);
  });

  it('says so when PowerPoint made no progress on the movie for a minute (Session 54, C review)', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const fake: PowerShellRunner = (_script, args) => {
      writeFileSync(named(args)['Started'] ?? '', '');
      return ran({
        code: 1,
        stderr: 'PowerPoint made no progress on the movie for a minute.\nAt line:40 char:7',
      });
    };
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4'), stallMs: 60_000 }, work, {
      runPowerShell: fake,
    });
    expect(r).toMatchObject({ ok: false, reason: 'it made no progress on the movie for a minute' });
    expect(r.ok ? '' : r.message).toBe(
      'PowerPoint stopped making the deck’s movie: it made no progress for a minute, as when it asks something in a window nobody sees.',
    );
  });

  it('a PowerPoint that does not finish in time is reported, and one cancelled says so', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const stuck: PowerShellRunner = () =>
      Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: true, aborted: false });
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuck,
    });
    expect(r).toMatchObject({ ok: false, reason: 'PowerPoint stopped answering' });
    const stopped: PowerShellRunner = () =>
      Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true });
    expect(
      await deckOnWindows({ input: deck, pptx: join(work, 'deck.pptx') }, work, { runPowerShell: stopped }),
    ).toMatchObject({
      ok: false,
      cancelled: true,
    });
  });

  it('saves an old .ppt as a .pptx, and a .pptx PowerPoint did not write is a failure', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const ppt = join(dir, 'Placeholder old.ppt');
    writeFileSync(ppt, 'old bytes');
    const asked: Record<string, string>[] = [];
    const fake: PowerShellRunner = (_script, args) => {
      asked.push(named(args));
      return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false });
    };
    const r = await deckOnWindows({ input: ppt, pptx: join(work, 'deck.pptx') }, work, {
      runPowerShell: fake,
    });
    expect(asked[0]?.['In']).toMatch(/\.ppt$/u);
    expect(asked[0]?.['Movie']).toBeUndefined();
    expect(r).toMatchObject({ ok: false, reason: 'it could not save it as a .pptx' });
  });
});

describe('PowerPoint’s own settings, put back even when its script was stopped (Session 54, C review)', () => {
  const deck = join(dir, 'Placeholder settings deck.pptx');
  writeFileSync(deck, 'placeholder deck bytes');

  it('each script writes its alerts and macro settings down, as numbers, before it changes them', () => {
    for (const script of [POWERPOINT_WINDOWS_BAKE_SCRIPT, POWERPOINT_WINDOWS_SCRIPT]) {
      const at = (text: string) => script.indexOf(text);
      const written = at(
        `if ($Settings -ne '') { Set-Content -LiteralPath $Settings -Value "$([int]$alerts),$([int]$security)" -Encoding ASCII }`,
      );
      expect(written).toBeGreaterThan(at('$security = $app.AutomationSecurity'));
      expect(written).toBeLessThan(at('try { $app.DisplayAlerts = 1 } catch {}'));
      expect(written).toBeLessThan(at('$app.AutomationSecurity = 3'));
      expect(script).toContain("[string]$Settings = ''");
    }
  });

  it('the put-back script finds the PowerPoint running, closes Drashti’s copy in it, and puts both back', () => {
    const script = POWERPOINT_WINDOWS_PUT_BACK_SCRIPT;
    expect(script).toContain(
      "[System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')",
    );
    expect(script).toContain('if ($p.FullName -eq $Copy) { $p.Close() }');
    expect(script).toContain('$app.DisplayAlerts = [int]$said[0]');
    expect(script).toContain('$app.AutomationSecurity = [int]$said[1]');
    // Never one it would start: GetActiveObject, never New-Object.
    expect(script).not.toContain('New-Object');
  });

  /** PowerShell as a stuck script leaves it: its settings written down (or not), `ids` started, nothing shown. */
  function stuckAfterChanging(
    script: string,
    options: { ids?: number[]; settings?: string; putBack?: Ran },
    asked: Record<string, string>[],
  ): PowerShellRunner {
    return (file, args) => {
      const text = readFileSync(file, 'utf8');
      const a = named(args);
      if (text === script) {
        writeFileSync(a['Started'] ?? '', (options.ids ?? []).join(','));
        if (options.settings !== undefined) writeFileSync(a['Settings'] ?? '', options.settings);
        return ran({ code: null, timedOut: true });
      }
      if (text === POWERPOINT_WINDOWS_SHOWN_SCRIPT) return ran({ stdout: '' });
      if (text === POWERPOINT_WINDOWS_PUT_BACK_SCRIPT) {
        asked.push({ ...a, settings: readFileSync(a['Settings'] ?? '', 'utf8') });
        return options.putBack ? Promise.resolve(options.putBack) : ran({ stdout: 'put back\r\n' });
      }
      return ran();
    };
  }

  it('the operator’s own PowerPoint: its settings put back as they were, and Drashti’s copy closed in it', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const asked: Record<string, string>[] = [];
    const log: string[] = [];
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuckAfterChanging(POWERPOINT_WINDOWS_BAKE_SCRIPT, { settings: '2,1' }, asked),
      log: (line) => log.push(line),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.['settings']).toBe('2,1');
    expect(asked[0]?.['Copy']).toMatch(/Drashti copy \d+\.pptx$/u);
    expect(r).toMatchObject({ ok: false, reason: 'PowerPoint stopped answering' });
    expect(r.ok ? '' : r.message).not.toContain('could not be put back');
    expect(log).toContain('PowerPoint: its alerts and macro settings put back as they were');
  });

  it('says so when they cannot be put back: PowerPoint opened again puts them back', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const asked: Record<string, string>[] = [];
    const r = await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuckAfterChanging(
        POWERPOINT_WINDOWS_BAKE_SCRIPT,
        {
          settings: '2,1',
          putBack: {
            code: 1,
            stdout: '',
            stderr: 'Call was rejected by callee.',
            timedOut: false,
            aborted: false,
          },
        },
        asked,
      ),
    });
    expect(asked).toHaveLength(1);
    expect(r.ok ? '' : r.message).toContain(
      'Its alerts and macro settings, turned off while it worked, could not be put back: quit PowerPoint and open it again.',
    );
  });

  it('saving as PDF: the same', async () => {
    const work = mkdtempSync(join(dir, 'work-'));
    const asked: Record<string, string>[] = [];
    const r = await convertToPdf('powerpoint', deck, work, {
      platform: 'win32',
      runPowerShell: stuckAfterChanging(POWERPOINT_WINDOWS_SCRIPT, { settings: '1,2' }, asked),
    });
    expect(asked.map((a) => a['settings'])).toEqual(['1,2']);
    expect(r).toMatchObject({ ok: false, reason: 'PowerPoint stopped answering' });
  });

  it('nothing to put back when the script stopped before it changed them, or when the PowerPoint Drashti started was stopped', async () => {
    const asked: Record<string, string>[] = [];
    const work = mkdtempSync(join(dir, 'work-'));
    await deckOnWindows({ input: deck, movie: join(work, 'movie.mp4') }, work, {
      runPowerShell: stuckAfterChanging(POWERPOINT_WINDOWS_BAKE_SCRIPT, {}, asked),
    });
    const ours = standInPowerPoint();
    const work2 = mkdtempSync(join(dir, 'work-'));
    await deckOnWindows({ input: deck, movie: join(work2, 'movie.mp4') }, work2, {
      runPowerShell: stuckAfterChanging(
        POWERPOINT_WINDOWS_BAKE_SCRIPT,
        { ids: [ours.pid], settings: '2,1' },
        asked,
      ),
    });
    expect(await ours.ended()).toBe(true);
    expect(asked).toEqual([]);
  });
});
