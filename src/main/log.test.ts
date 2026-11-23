import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { log, logFiles, scrub, startLogCopy, startLogFile } from './log';

describe('the log file', () => {
  it('keeps the home folder and file URLs out of every line', () => {
    expect(scrub(`opened ${join(homedir(), 'Library', 'x.sqlite')}`)).toBe(
      `opened ${join('~', 'Library', 'x.sqlite')}`,
    );
    expect(scrub('from file:///Volumes/Old/Song.pro6 and more')).toBe('from file://… and more');
  });

  it('hides the key part of any RTMP address in every line, whatever wrote it (Session 28; the skills review MED-4)', () => {
    expect(scrub('push to rtmps://a.rtmp.youtube.com/live2/made-up-key-0000 failed')).toBe(
      'push to rtmps://a.rtmp.youtube.com/live2/[stream key] failed',
    );
    expect(scrub('rtmp://127.0.0.1:1935/live/placeholder_key-1')).toBe(
      'rtmp://127.0.0.1:1935/live/[stream key]',
    );
  });

  it('rotates when full, keeping the newest files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-log-'));
    startLogFile(dir, { maxBytes: 200, keep: 3 });
    for (let i = 0; i < 30; i++) log.info(`placeholder line ${i}`);
    expect(readdirSync(dir).sort()).toEqual(['drashti.1.log', 'drashti.2.log', 'drashti.log']);
    const files = logFiles();
    expect(files[0]).toBe(join(dir, 'drashti.log'));
    expect(readFileSync(join(dir, 'drashti.log'), 'utf8')).toContain('placeholder line 29');
  });

  it('with a test’s copy, writes every line there too, whole and scrubbed, however the files rotate (alpha.21: a failed test keeps its Drashti’s log)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-log-'));
    const copy = join(mkdtempSync(join(tmpdir(), 'drashti-test-out-')), 'a', 'drashti-1.log');
    startLogFile(dir, { maxBytes: 200, keep: 2 });
    startLogCopy(copy);
    for (let i = 0; i < 30; i++) log.info(`placeholder copy ${i} at ${join(homedir(), 'x')}`);
    const lines = readFileSync(copy, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(30);
    expect(lines[0]).toContain('placeholder copy 0 at ~');
    expect(lines[29]).toContain('placeholder copy 29');
    expect(readFileSync(copy, 'utf8')).not.toContain(homedir());
  });

  it('a copy that cannot be written never gets in the way: the log file goes on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-log-'));
    startLogFile(dir);
    // A folder where the file should be: every write to the copy fails.
    const copy = mkdtempSync(join(tmpdir(), 'drashti-test-out-'));
    startLogCopy(copy);
    expect(() => {
      log.warn('placeholder after a broken copy');
    }).not.toThrow();
    expect(readFileSync(join(dir, 'drashti.log'), 'utf8')).toContain('placeholder after a broken copy');
  });
});
