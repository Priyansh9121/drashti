import { describe, expect, it } from 'vitest';
import {
  LOCK_REASON_TEXT,
  NO_CONTACT_COME_BACK_TEXT,
  NO_CONTACT_STOP_TEXT,
  NO_CONTACT_STOP_TITLE,
  offlineLeftText,
  offlineLine,
} from './access';
import { ACCESS_STOP_AFTER_MS } from './access-protocol';

/*
 * The words of 15 days without the internet (Session 55, the owner's decisions of 29 Oct 2026): the line under the top
 * bar, shorter as it runs down, and the stop and lock screen at its end, which say to ask for access again.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('the line under the top bar', () => {
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
