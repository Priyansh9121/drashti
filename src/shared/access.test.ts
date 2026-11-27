import { describe, expect, it } from 'vitest';
import {
  LOCK_REASON_TEXT,
  NO_CONTACT_COME_BACK_TEXT,
  NO_CONTACT_STOP_TEXT,
  NO_CONTACT_STOP_TITLE,
  OFFLINE_DAYS_TEXT,
  OFFLINE_SHORT_ROOM,
  OFFLINE_SHORT_TEXT,
  offlineLeftText,
  offlineLine,
  offlineShortLeft,
} from './access';
import { ACCESS_STOP_AFTER_MS } from './access-protocol';

/*
 * The words of 15 days without the internet (Session 55, the owner's decisions of 29 Oct 2026): the line under the top
 * bar, shorter as it runs down, and the stop and lock screen at its end, which say to ask for access again.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('the line in the status bar (under the top bar before alpha.24)', () => {
  it('says the owner’s own example: 14 days 6 hours', () => {
    expect(offlineLine(14 * DAY + 6 * HOUR + 59 * MINUTE)).toBe(
      'Can’t reach the access list: Drashti keeps working for 14 days 6 hours more.',
    );
  });

  it('chooses shorter forms as it runs down, each part rounded down and a part of none left out', () => {
    const forms: [number, string][] = [
      [ACCESS_STOP_AFTER_MS - 2 * MINUTE, '14 days 23 hours'],
      [2 * DAY, '2 days'],
      [DAY + HOUR, '1 day 1 hour'],
      [DAY, '1 day'],
      [DAY - 1, '23 hours 59 minutes'],
      [5 * HOUR + 20 * MINUTE + 59_999, '5 hours 20 minutes'],
      [3 * HOUR, '3 hours'],
      [HOUR + MINUTE, '1 hour 1 minute'],
      [HOUR - 1, '59 minutes'],
      [58 * MINUTE, '58 minutes'],
      [MINUTE, '1 minute'],
      [59_999, 'less than a minute'],
      [0, 'less than a minute'],
      [-5_000, 'less than a minute'],
    ];
    for (const [ms, words] of forms) expect(offlineLeftText(ms), String(ms)).toBe(words);
  });

  it('in sight, a short form that fits the version’s room, never cut; the whole line in its tooltip and read out (alpha.24)', () => {
    // Lead 2's decision inside the owner's QA24-ACCESS-STRIP A (27 Nov 2026): the version's room ("Drashti 1.0.0-alpha.24",
    // about 123 px at 1024 wide) shows only "Can’t reach th…" of the whole line.
    expect(OFFLINE_SHORT_TEXT).toBe('No access list');
    expect(OFFLINE_SHORT_TEXT.length).toBeLessThanOrEqual(14);
    // What the whole line is about, which stays the owner's own words.
    expect(offlineLine(DAY)).toContain('access list');
    expect(OFFLINE_SHORT_TEXT).not.toContain('…');
  });
});

/*
 * The days left in sight (alpha.25 item 5, in alpha.24: the owner's delegate's words through lead 2, 28 Nov 2026):
 * "⚠ No access list · 14 days", then "· 5 hours" in the last day and "· 40 minutes" in the last hour, rounded down;
 * the line's room holds the widest of each, so nothing moves as the count or its unit changes.
 */
describe('the line’s countdown in sight', () => {
  it('days while a day or more is left, then hours, then minutes, each rounded down', () => {
    const forms: [number, string][] = [
      [ACCESS_STOP_AFTER_MS, '15 days'],
      [ACCESS_STOP_AFTER_MS - 2 * MINUTE, '14 days'],
      [14 * DAY + 6 * HOUR + 59 * MINUTE, '14 days'],
      [2 * DAY, '2 days'],
      [DAY + 23 * HOUR, '1 day'],
      [DAY, '1 day'],
      [DAY - 1, '23 hours'],
      [5 * HOUR + 59 * MINUTE, '5 hours'],
      [HOUR, '1 hour'],
      [HOUR - 1, '59 minutes'],
      [40 * MINUTE + 59_999, '40 minutes'],
      [MINUTE, '1 minute'],
    ];
    for (const [ms, words] of forms) expect(offlineShortLeft(ms), String(ms)).toBe(words);
  });

  it('never less than 1 minute in sight (the whole line says less than a minute)', () => {
    for (const ms of [59_999, 1, 0, -5_000]) expect(offlineShortLeft(ms), String(ms)).toBe('1 minute');
    expect(offlineLine(59_999)).toContain('less than a minute');
  });

  it('its room: the widest of each unit, so every count fits in it', () => {
    expect(OFFLINE_SHORT_ROOM).toEqual([OFFLINE_DAYS_TEXT, '23 hours', '59 minutes']);
    expect(OFFLINE_DAYS_TEXT).toBe('15 days');
    // Every count has as many digits as its unit's widest, or fewer, and the same unit word.
    for (let ms = 0; ms <= ACCESS_STOP_AFTER_MS; ms += 7 * MINUTE) {
      const words = offlineShortLeft(ms);
      const [count, unit] = words.split(' ');
      const widest = OFFLINE_SHORT_ROOM.find(
        (w) => w.split(' ')[1]?.replace(/s$/u, '') === unit?.replace(/s$/u, ''),
      );
      expect(widest, words).toBeDefined();
      expect(count?.length, words).toBeLessThanOrEqual(widest?.split(' ')[0]?.length ?? 0);
      expect(words, words).not.toContain('…');
    }
  });
});

describe('the end of the 15 days', () => {
  it('stops as a revoke does, saying to ask for access again with Request Access', () => {
    expect(ACCESS_STOP_AFTER_MS).toBe(15 * DAY);
    expect(NO_CONTACT_STOP_TITLE).toBe('Drashti could not check your access for 15 days');
    expect(NO_CONTACT_STOP_TEXT).toContain('15 days');
    expect(NO_CONTACT_COME_BACK_TEXT).toContain('ask the person who approves access for access again');
    expect(NO_CONTACT_COME_BACK_TEXT).toContain('Request Access');
    expect(LOCK_REASON_TEXT['no-contact']).toContain('15 days');
    expect(LOCK_REASON_TEXT['no-contact']).toContain('Request Access');
    expect(LOCK_REASON_TEXT['no-answer']).toContain('within 15 days of a check that let it in');
    expect(LOCK_REASON_TEXT['no-answer']).not.toContain('hour');
  });
});
