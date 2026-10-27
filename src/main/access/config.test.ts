import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_LIST_PUBLIC_KEY,
  ACCESS_LIST_URL,
  accessConfigReal,
  accessKeyShaped,
  parseSetupLine,
} from '../../shared/access-config';

/*
 * The access list's address and public key built into Drashti (Session 54, E1): placeholders until the
 * owner sends the line Set up… shows, and never mistaken for real ones. The keys here are made by the test.
 */

const realKey = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ type: 'spki', format: 'der' })
    .toString('base64');
const URL = 'https://script.google.com/macros/s/AKfycbMadeUpDeploymentId0123456789_-x/exec';

describe('the access list’s address and key', () => {
  it('are placeholders now, and say so', () => {
    expect(ACCESS_LIST_URL).toContain('PLACEHOLDER');
    expect(ACCESS_LIST_PUBLIC_KEY).toContain('PLACEHOLDER');
    expect(accessConfigReal()).toBe(false);
  });

  it('are real only as Apps Script and Set up… make them', () => {
    const key = realKey();
    expect(accessKeyShaped(key)).toBe(true);
    expect(accessConfigReal(URL, key)).toBe(true);
    expect(
      accessConfigReal('https://script.google.com/a/macros/example.com/s/AKfycbMadeUp0123/exec', key),
    ).toBe(true);
    expect(accessConfigReal(URL.replace('/exec', '/dev'), key)).toBe(false);
    expect(accessConfigReal(URL.replace('https:', 'http:'), key)).toBe(false);
    expect(
      accessConfigReal('https://script.google.com.example.com/macros/s/AKfycbMadeUp0123/exec', key),
    ).toBe(false);
    expect(accessConfigReal(URL, key.slice(1))).toBe(false);
    const small = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    expect(accessConfigReal(URL, small.toString('base64'))).toBe(false);
  });

  it('come from the one line Set up… shows', () => {
    const key = realKey();
    expect(parseSetupLine(` ${URL}#key=${key} `)).toEqual({ url: URL, publicKey: key });
    expect(parseSetupLine(`${URL} #key=${key}`)).toBeNull();
    expect(parseSetupLine(URL)).toBeNull();
    expect(parseSetupLine(`${ACCESS_LIST_URL}#key=${key}`)).toBeNull();
  });
});
