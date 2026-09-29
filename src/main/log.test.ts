import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { log, logFiles, scrub, startLogFile } from './log';

describe('the log file', () => {
  it('keeps the home folder and file URLs out of every line', () => {
    expect(scrub(`opened ${join(homedir(), 'Library', 'x.sqlite')}`)).toBe(
      `opened ${join('~', 'Library', 'x.sqlite')}`,
    );
    expect(scrub('from file:///Volumes/Old/Song.pro6 and more')).toBe('from file://… and more');
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
});
