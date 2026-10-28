import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { core } from '../../../tests/access-core';
import {
  ACCESS_CHECK_EVERY_MS,
  ACCESS_CHECK_STATUSES,
  ACCESS_ERRORS,
  ACCESS_LENGTH_DAYS,
  ACCESS_LENGTH_MAX_DAYS,
  ACCESS_LIMITS,
  ACCESS_LINK_MS,
  ACCESS_MAC_PREFIX,
  ACCESS_OWNER_OPS,
  ACCESS_PUBLIC_OPS,
  ACCESS_REQUEST_STATUSES,
  ACCESS_STATUSES,
  ACCESS_STOP_AFTER_MS,
  ACCESS_TOKEN_ALPHABET,
  ACCESS_TOKEN_LENGTH,
  ACCESS_TOKEN_MS,
  ACCESS_VERSION,
  canonicalJson,
  formatToken,
  gmailKey,
  gmailShaped,
  normaliseToken,
} from '../../shared/access-protocol';

/*
 * The access list keeps its own copy of the protocol (access-list/core.js cannot import, being Apps Script):
 * every number, list and helper must be Drashti's (src/shared/access-protocol.ts), or a check's mac, a
 * token or a Gmail would be read differently on each side (Session 54, E1).
 */

describe('the access list’s copy of the protocol', () => {
  it('keeps Drashti’s numbers: checks every 15 s, stop after an hour with no answer, tokens 3 days, links 7 days, the limits', () => {
    const p = core.PROTOCOL;
    expect(p.version).toBe(ACCESS_VERSION);
    expect(p.checkEveryMs).toBe(ACCESS_CHECK_EVERY_MS);
    expect(p.checkEveryMs).toBe(15_000);
    expect(p.stopAfterMs).toBe(ACCESS_STOP_AFTER_MS);
    expect(p.stopAfterMs).toBe(3_600_000);
    expect(p.tokenMs).toBe(ACCESS_TOKEN_MS);
    expect(p.tokenMs).toBe(3 * 24 * 3600_000);
    expect(p.linkMs).toBe(ACCESS_LINK_MS);
    expect(p.linkMs).toBe(7 * 24 * 3600_000);
    expect(p.limits).toEqual(ACCESS_LIMITS);
  });

  it('keeps Drashti’s ops, statuses, refusals, token letters and mac prefix', () => {
    const p = core.PROTOCOL;
    expect(p.publicOps).toEqual(ACCESS_PUBLIC_OPS);
    expect(p.ownerOps).toEqual(ACCESS_OWNER_OPS);
    expect(p.statuses).toEqual(ACCESS_STATUSES);
    expect(p.checkStatuses).toEqual(ACCESS_CHECK_STATUSES);
    expect(p.requestStatuses).toEqual(ACCESS_REQUEST_STATUSES);
    expect(p.errors).toEqual(ACCESS_ERRORS);
    expect(Object.keys(core.MESSAGES).sort()).toEqual([...ACCESS_ERRORS].sort());
    expect(p.tokenAlphabet).toBe(ACCESS_TOKEN_ALPHABET);
    expect(p.tokenLength).toBe(ACCESS_TOKEN_LENGTH);
    expect(p.macPrefix).toBe(ACCESS_MAC_PREFIX);
  });

  it('gives the same lengths of access Drashti offers: 1 day, 7 to 365 days, up to 730 typed, and Unlimited', () => {
    expect(core.PROTOCOL.lengths).toEqual({ days: [...ACCESS_LENGTH_DAYS], maxDays: ACCESS_LENGTH_MAX_DAYS });
    expect(core.MESSAGES['bad-length']).toContain(String(ACCESS_LENGTH_MAX_DAYS));
  });

  it('makes the same canonical JSON as Drashti from the same call', () => {
    const samples: unknown[] = [
      {
        v: 1,
        op: 'check',
        nonce: randomBytes(16).toString('hex'),
        at: 1_793_000_000_000,
        activity: { minutes: 3 },
      },
      {
        computer: { name: 'Placeholder ક્ષ Mac 😀', id: 'x', version: '1.0.0-alpha.13' },
        b: [1, 'two', null, false],
      },
      { weird: '\u0000\u001f\u007f\u2028\u202e"\\/', nested: { z: { y: { x: [] } } }, n: -0.5, big: 2 ** 52 },
      { order: { b: 1, a: 2, A: 3, _: 4, '1': 5 }, skipped: undefined },
      [],
      'text',
      12,
      null,
    ];
    for (const s of samples) expect(core.canonicalJson(s)).toBe(canonicalJson(s));
  });

  it('reads a Gmail, and a typed token, as Drashti does', () => {
    for (const a of [
      ' Placeholder.User+drashti@GoogleMail.com ',
      'placeholder.user@gmail.com',
      'Placeholder.User+x@Example.com',
      "o'placeholder@example.org",
      'no-at',
      '+only@gmail.com',
      'pläce@example.com',
      'x@example',
    ]) {
      expect(core.gmailKey(a)).toBe(gmailKey(a));
      expect(core.gmailShaped(a)).toBe(gmailShaped(a));
    }
    for (const t of [
      '0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV',
      ' o123 4567 89ab cdef ghjk mnpq rstv ',
      'short',
      'U'.repeat(28),
    ]) {
      expect(core.normaliseToken(t)).toBe(normaliseToken(t));
    }
    expect(core.formatToken('0123456789ABCDEFGHJKMNPQRSTV')).toBe(
      formatToken('0123456789ABCDEFGHJKMNPQRSTV'),
    );
  });
});
