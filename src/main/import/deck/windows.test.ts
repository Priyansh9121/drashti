import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deckOnWindows, POWERPOINT_WINDOWS_BAKE_SCRIPT, type PowerShellRunner } from '../deck-converters';

/*
 * PowerPoint on Windows making a deck's movie (Session 54, C2), from Microsoft's documentation: CI has no Office,
 * so the script is read here, and what Drashti does with it is tried with a stand-in for PowerShell that answers
 * as PowerPoint would (the mandir PC tries it for real: assister/session-54-deck-trial.md).
 */

const dir = mkdtempSync(join(tmpdir(), 'drashti-windows-deck-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

  it('writes down the PowerPoint it started, below normal priority, and quits it only when nothing else is open', () => {
    expect(at('Set-Content -LiteralPath $Started')).toBeLessThan(at('$app.Presentations.Open('));
    expect(script).toContain("PriorityClass = 'BelowNormal'");
    expect(script).toContain('if ($ours.Count -gt 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }');
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
      { input: deck, pdf: join(work, 'pictures.pdf'), movie, movieLimitMs: 300_000 },
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
