import { randomUUID } from 'node:crypto';
import type { Announcement, AnnouncementStatus, ShownAs } from '../../shared/announcements';
import type { Db } from './database';

/*
 * Announcements from phones (migration 19). A change of status happens only
 * from the status before it (waiting, then showing or rejected; showing,
 * then ended), so two changes racing each other cannot both happen.
 */

interface Row {
  id: string;
  text: string;
  sent_text: string;
  from_name: string;
  minutes: number;
  device_name: string;
  status: AnnouncementStatus;
  shown_as: ShownAs | null;
  sent_at: string;
  decided_at: string | null;
  until: string | null;
  ended_at: string | null;
}

const COLUMNS =
  'id, text, sent_text, from_name, minutes, device_name, status, shown_as, sent_at, decided_at, until, ended_at';

const toAnnouncement = (r: Row): Announcement => ({
  id: r.id,
  text: r.text,
  sentText: r.sent_text,
  from: r.from_name,
  minutes: r.minutes,
  deviceName: r.device_name,
  status: r.status,
  shownAs: r.shown_as,
  sentAt: r.sent_at,
  decidedAt: r.decided_at,
  until: r.until,
  endedAt: r.ended_at,
});

export class AnnouncementRepo {
  constructor(private readonly db: Db) {}

  add(a: {
    text: string;
    from: string;
    minutes: number;
    deviceId: string;
    deviceName: string;
    sentAt: string;
  }): Announcement {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO announcements (id, text, sent_text, from_name, minutes, device_id, device_name, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, a.text, a.text, a.from, a.minutes, a.deviceId, a.deviceName, a.sentAt);
    const added = this.get(id);
    if (!added) throw new Error('The announcement was not kept.');
    return added;
  }

  get(id: string): Announcement | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM announcements WHERE id = ?`).get(id) as
      Row | undefined;
    return row ? toAnnouncement(row) : null;
  }

  /** The device it came from (null once that device is removed). */
  deviceOf(id: string): string | null {
    const row = this.db.prepare('SELECT device_id FROM announcements WHERE id = ?').get(id) as
      { device_id: string | null } | undefined;
    return row?.device_id ?? null;
  }

  /** Those with this status, oldest first. */
  withStatus(status: AnnouncementStatus): Announcement[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM announcements WHERE status = ? ORDER BY sent_at, rowid`)
        .all(status) as Row[]
    ).map(toAnnouncement);
  }

  /** The most recent that ended or were rejected, newest first. */
  earlier(limit: number): Announcement[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM announcements WHERE status IN ('ended', 'rejected')
           ORDER BY COALESCE(ended_at, decided_at, sent_at) DESC, rowid DESC LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map(toAnnouncement);
  }

  waitingCount(deviceId?: string): number {
    const row = (
      deviceId === undefined
        ? this.db.prepare("SELECT COUNT(*) AS n FROM announcements WHERE status = 'waiting'").get()
        : this.db
            .prepare("SELECT COUNT(*) AS n FROM announcements WHERE status = 'waiting' AND device_id = ?")
            .get(deviceId)
    ) as { n: number };
    return row.n;
  }

  /** New words or time for one still waiting. */
  edit(id: string, text: string, minutes: number): boolean {
    return (
      this.db
        .prepare("UPDATE announcements SET text = ?, minutes = ? WHERE id = ? AND status = 'waiting'")
        .run(text, minutes, id).changes === 1
    );
  }

  approve(id: string, shownAs: ShownAs, decidedAt: string, until: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE announcements SET status = 'showing', shown_as = ?, decided_at = ?, until = ? WHERE id = ? AND status = 'waiting'",
        )
        .run(shownAs, decidedAt, until, id).changes === 1
    );
  }

  reject(id: string, decidedAt: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE announcements SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'waiting'",
        )
        .run(decidedAt, id).changes === 1
    );
  }

  end(id: string, endedAt: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE announcements SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'showing'",
        )
        .run(endedAt, id).changes === 1
    );
  }

  /** Forget those that ended or were rejected before this time. */
  prune(before: string): number {
    return this.db
      .prepare(
        "DELETE FROM announcements WHERE status IN ('ended', 'rejected') AND COALESCE(ended_at, decided_at, sent_at) < ?",
      )
      .run(before).changes;
  }
}
