import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPriority, describePriorities, readPriority, writePriority } from './priority';

describe('the main process priority on Windows (Session 16)', () => {
  it('is above normal unless an admin set it back to normal, kept in the data folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-priority-'));
    expect(readPriority(dir, undefined)).toBe('above-normal');
    writePriority(dir, 'normal');
    expect(JSON.parse(readFileSync(join(dir, 'drashti-priority.json'), 'utf8'))).toEqual({
      priority: 'normal',
    });
    expect(readPriority(dir, undefined)).toBe('normal');
    writePriority(dir, 'above-normal');
    expect(readPriority(dir, undefined)).toBe('above-normal');
    // Anything else in the file, or a damaged file, is the default.
    writeFileSync(join(dir, 'drashti-priority.json'), '{"priority": "high"');
    expect(readPriority(dir, undefined)).toBe('above-normal');
  });

  it('can be set for one run by the environment (the performance check compares the two)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-priority-'));
    writePriority(dir, 'normal');
    expect(readPriority(dir, 'above-normal')).toBe('above-normal');
    expect(readPriority(dir, 'normal')).toBe('normal');
    expect(readPriority(dir, 'realtime')).toBe('normal');
  });

  it('is set on Windows only, and a refusal leaves it as it was', () => {
    const set: number[] = [];
    expect(applyPriority('normal', 'darwin', (v) => set.push(v))).toBe(false);
    expect(applyPriority('normal', 'win32', (v) => set.push(v))).toBe(true);
    expect(applyPriority('above-normal', 'win32', (v) => set.push(v))).toBe(true);
    expect(set).toEqual([constants.priority.PRIORITY_NORMAL, constants.priority.PRIORITY_ABOVE_NORMAL]);
    expect(
      applyPriority('normal', 'win32', () => {
        throw new Error('not allowed');
      }),
    ).toBe(false);
  });

  it("counts Drashti's other processes by priority, most first", () => {
    const at: Record<number, string> = { 1: 'normal', 2: 'normal', 3: 'below normal', 4: 'normal' };
    expect(describePriorities([1, 2, 3, 4], (pid) => at[pid ?? 0] ?? 'unknown')).toBe(
      'normal ×3, below normal ×1',
    );
    expect(describePriorities([], () => 'normal')).toBe('');
  });
});
