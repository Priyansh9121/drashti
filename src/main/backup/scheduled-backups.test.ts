import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupSchedule, ScheduledBackupsView } from '../../shared/backups';
import type { FromBackupWorker, ToBackupWorker } from './protocol';
import { ScheduledBackups } from './scheduled-backups';

/* When scheduled backups run, wait or are skipped (a fake worker and a clock the test moves). */

function setup(start = new Date(2026, 9, 6, 20, 0).getTime()) {
  const clock = { now: start };
  const settings = new Map<string, unknown>();
  const timers: { at: number; run: () => void }[] = [];
  const workers: { sent: ToBackupWorker[]; reply: (m: FromBackupWorker) => void; killed: boolean }[] = [];
  const views: ScheduledBackupsView[] = [];
  const state = { onAir: false, busy: false };
  const drive = mkdtempSync(join(tmpdir(), 'drashti-sched-'));
  const service = new ScheduledBackups({
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    now: () => clock.now,
    engineNow: () => clock.now,
    onAir: () => state.onAir,
    busy: () => state.busy,
    spawn: () => {
      let listener: (m: FromBackupWorker) => void = () => undefined;
      const w = { sent: [] as ToBackupWorker[], reply: (m: FromBackupWorker) => listener(m), killed: false };
      workers.push(w);
      return {
        post: (m) => w.sent.push(m),
        onMessage: (l) => {
          listener = l;
        },
        onExit: () => undefined,
        kill: () => {
          w.killed = true;
        },
      };
    },
    dbFile: '/placeholder/drashti.sqlite',
    mediaDir: '/placeholder/Media',
    userData: '/placeholder',
    app: '1.0',
    schema: 31,
    sameDisk: () => false,
    changed: (v) => views.push(v),
    log: () => undefined,
    schedule: (ms, run) => {
      const t = { at: clock.now + ms, run };
      timers.push(t);
      return () => {
        timers.splice(timers.indexOf(t), 1);
      };
    },
  });
  const tick = (ms: number) => {
    const end = clock.now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock.now = Math.max(clock.now, next.at);
      timers.splice(timers.indexOf(next), 1);
      next.run();
    }
    clock.now = end;
  };
  const schedule = (over: Partial<BackupSchedule> = {}): BackupSchedule => ({
    enabled: true,
    folder: drive,
    days: [0, 1, 2, 3, 4, 5, 6],
    time: '21:00',
    keep: 3,
    media: true,
    ...over,
  });
  return { clock, settings, workers, views, state, drive, service, tick, schedule };
}

describe('scheduled backups', () => {
  it('start at their time in a worker, and say how it went', () => {
    const t = setup();
    expect(t.service.save(t.schedule()).ok).toBe(true);
    expect(t.service.view().nextAt).toBe(new Date(2026, 9, 6, 21, 0).getTime());
    t.tick(59 * 60_000);
    expect(t.workers).toHaveLength(0);
    t.tick(61_000);
    expect(t.workers).toHaveLength(1);
    const start = t.workers[0]?.sent[0];
    expect(start).toMatchObject({ type: 'start', root: t.drive, keep: 3, mediaDir: '/placeholder/Media' });
    expect(t.service.view().state).toBe('running');
    t.workers[0]?.reply({
      type: 'done',
      folder: 'Drashti backup x',
      copied: 2,
      files: 5,
      bytesCopied: 10,
      removed: 1,
      poolRemoved: 0,
    });
    expect(t.service.view()).toMatchObject({
      state: 'idle',
      warning: null,
      last: { outcome: 'done', copied: 2, files: 5 },
    });
    expect(t.workers[0]?.killed).toBe(true);
  });

  it('skip a time when the folder is not there, with a warning until the next good one or dismissed', () => {
    const t = setup();
    t.service.save(t.schedule({ folder: join(t.drive, 'USB drive taken out') }));
    t.tick(61 * 60_000);
    expect(t.workers).toHaveLength(0);
    const view = t.service.view();
    expect(view.last?.outcome).toBe('skipped');
    expect(view.warning).toContain('Backup at 21:00 skipped');
    expect(view.warning).toContain('is the drive connected');
    t.service.dismiss();
    expect(t.service.view().warning).toBeNull();
  });

  it('wait while the stream is on air, before and in the middle; pause and go on', () => {
    const t = setup();
    t.service.save(t.schedule());
    t.state.onAir = true;
    t.tick(61 * 60_000);
    expect(t.workers).toHaveLength(0);
    expect(t.service.view()).toMatchObject({
      state: 'waiting',
      waitingFor: 'the stream is on air or recording',
    });
    t.state.onAir = false;
    t.tick(3000);
    expect(t.workers).toHaveLength(1);
    t.state.onAir = true;
    t.tick(3000);
    expect(t.workers[0]?.sent.at(-1)).toEqual({ type: 'pause' });
    expect(t.service.view().state).toBe('waiting');
    t.state.onAir = false;
    t.tick(3000);
    expect(t.workers[0]?.sent.at(-1)).toEqual({ type: 'resume' });
  });

  it('never run a time that passed while Drashti was closed, and keep schedules outside the data folder', () => {
    const t = setup(new Date(2026, 9, 6, 21, 30).getTime());
    t.service.save(t.schedule());
    t.tick(10 * 60_000);
    expect(t.workers).toHaveLength(0);
    const inside = t.service.save(t.schedule({ folder: '/placeholder/Backups' }));
    expect(inside.ok ? '' : inside.message).toContain('outside Drashti’s own data folder');
    expect(t.service.save(t.schedule({ days: [] })).ok).toBe(false);
    // Back up now tries the folder at once.
    expect(t.service.runNow().ok).toBe(true);
    expect(t.workers).toHaveLength(1);
  });
});
