import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RateLimiter, WrongCodeLimiter } from './limits';
import { apiQuery, listWebFiles, safeRequestPath } from './web-files';

describe('limits on the network', () => {
  it('lets a device ask so much a second, with a burst', () => {
    let t = 0;
    const limit = new RateLimiter(2, 3, () => t);
    expect([1, 2, 3, 4].map(() => limit.take('phone'))).toEqual([true, true, true, false]);
    expect(limit.take('tablet')).toBe(true);
    t += 500;
    expect(limit.take('phone')).toBe(true);
    expect(limit.take('phone')).toBe(false);
  });

  it('refuses every try from an address after five wrong codes in a minute, and everyone after thirty', () => {
    let t = 0;
    const limit = new WrongCodeLimiter(5, 30, 60_000, () => t);
    for (let i = 0; i < 5; i++) {
      expect(limit.allowed('192.168.1.50')).toBe(true);
      limit.failed('192.168.1.50');
    }
    expect(limit.allowed('192.168.1.50')).toBe(false);
    expect(limit.allowed('192.168.1.51')).toBe(true);
    t += 60_001;
    expect(limit.allowed('192.168.1.50')).toBe(true);
    for (let i = 0; i < 30; i++) limit.failed(`10.0.0.${i}`);
    expect(limit.allowed('192.168.1.99')).toBe(false);
  });
});

describe('the pages’ files', () => {
  it('serves only the listed pages and assets, never a path that escapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'remote.html'), '<!doctype html>');
    writeFileSync(join(dir, 'pair.html'), '<!doctype html>');
    writeFileSync(join(dir, 'index.html'), 'the operator window');
    writeFileSync(join(dir, 'assets', 'remote-abc123.js'), 'x');
    writeFileSync(join(dir, 'assets', 'notes.txt'), 'not a web type');
    const files = listWebFiles(dir);
    expect([...files.keys()].sort()).toEqual(['/', '/assets/remote-abc123.js', '/pair', '/remote']);
    expect(files.get('/assets/remote-abc123.js')?.immutable).toBe(true);
    rmSync(dir, { recursive: true, force: true });

    for (const bad of [
      '/../drashti.sqlite',
      '/assets/../../drashti.sqlite',
      '/assets/%2e%2e/%2e%2e/drashti.sqlite',
      '/assets/..%2f..%2fdrashti.sqlite',
      '/assets/%252e%252e/x',
      '/assets/..\\..\\x',
      '/assets/%5c..%5cx',
      '/assets/x%00.js',
      '//etc/passwd',
      'assets/x.js',
      '/%E0%A4%A',
    ])
      expect(safeRequestPath(bad), bad).toBeNull();
    expect(safeRequestPath('/assets/remote-abc123.js?v=1')).toBe('/assets/remote-abc123.js');
    expect(safeRequestPath('/remote')).toBe('/remote');
  });

  it("reads a GET request's query as plain strings, a few short ones (Session 18)", () => {
    expect(apiQuery('/api/v1/presentations')).toEqual({});
    expect(apiQuery('/api/v1/presentations?offset=100&limit=50')).toEqual({ offset: '100', limit: '50' });
    // The first of a name, decoded; names that are not plain words are left out.
    expect(apiQuery('/api/v1/search?q=placeholder%20words&q=other&Q=x&__proto__=1&a-b=2')).toEqual({
      q: 'placeholder words',
    });
    expect(apiQuery(`/api/v1/search?q=${'x'.repeat(500)}`)['q']).toHaveLength(200);
    const many = Array.from({ length: 20 }, (_, i) => `${String.fromCharCode(97 + i)}=1`).join('&');
    expect(Object.keys(apiQuery(`/x?${many}`))).toHaveLength(8);
    // A broken escape is read as it can be, never thrown on.
    expect(typeof apiQuery('/x?q=%E0%A4%A')['q']).toBe('string');
  });
});
