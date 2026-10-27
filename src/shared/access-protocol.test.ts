import { describe, expect, it } from 'vitest';
import {
  ACCESS_ERROR_TEXT,
  ACCESS_ERRORS,
  ACCESS_TOKEN_ALPHABET,
  canonicalJson,
  formatToken,
  gmailKey,
  gmailShaped,
  normaliseToken,
} from './access-protocol';

/* What Drashti and the access list must make alike (Session 54, E1); placeholder addresses only. */

describe('canonical JSON', () => {
  it('puts keys in order, leaves out undefined, and writes everything past ASCII as \\u escapes', () => {
    expect(canonicalJson({ b: 1, a: 'x', c: [true, null, { z: 0, y: undefined }] })).toBe(
      '{"a":"x","b":1,"c":[true,null,{"z":0}]}',
    );
    expect(canonicalJson({ name: 'Placeholder નામ 😀', tab: '\t' })).toBe(
      '{"name":"Placeholder \\u0aa8\\u0abe\\u0aae \\ud83d\\ude00","tab":"\\t"}',
    );
    expect(canonicalJson([undefined])).toBe('[null]');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
    expect(() => canonicalJson({ f: () => 1 })).toThrow();
  });
});

describe('a Gmail’s one form', () => {
  it('drops the dots and +words of gmail.com and googlemail.com, and only there', () => {
    expect(gmailKey(' Placeholder.User+drashti@GoogleMail.com ')).toBe('placeholderuser@gmail.com');
    expect(gmailKey('placeholder.user@gmail.com')).toBe('placeholderuser@gmail.com');
    expect(gmailKey('Placeholder.User+x@Example.com')).toBe('placeholder.user+x@example.com');
    expect(gmailKey('no-at')).toBe('');
    expect(gmailKey('+only@gmail.com')).toBe('');
  });

  it('takes a plain address of any domain, and nothing else', () => {
    for (const a of ['placeholder.user@example.com', "o'placeholder@example.org", 'x_y-z@sub.example.co.uk'])
      expect(gmailShaped(a)).toBe(true);
    for (const a of [
      '',
      'x',
      '@example.com',
      'x@example',
      'pläce@example.com',
      'x y@example.com',
      'x@@example.com',
    ])
      expect(gmailShaped(a)).toBe(false);
  });
});

describe('a token as typed', () => {
  it('reads lower case, spaces, dashes, O for 0 and I or L for 1, and refuses anything else', () => {
    const letters = '0123456789ABCDEFGHJKMNPQRSTV';
    expect(normaliseToken(formatToken(letters))).toBe(letters);
    expect(formatToken(letters)).toBe('0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV');
    expect(normaliseToken(' o123 4567 89ab cdef ghjk mnpq rstv ')).toBe(letters);
    expect(normaliseToken('L123-4567-89AB-CDEF-GHJK-MNPQ-RSTV')).toBe(`1${letters.slice(1)}`);
    expect(normaliseToken(letters.slice(1))).toBeNull();
    expect(normaliseToken(`${letters.slice(1)}U`)).toBeNull();
    expect(ACCESS_TOKEN_ALPHABET).toHaveLength(32);
  });
});

describe('the refusals', () => {
  it('each have Drashti’s own words', () => {
    for (const e of ACCESS_ERRORS) expect(ACCESS_ERROR_TEXT[e].length).toBeGreaterThan(10);
  });
});
