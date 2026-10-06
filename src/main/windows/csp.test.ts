import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_PAGES } from '../network/web-files';

/*
 * Every page's Content Security Policy: scripts only from the app, nothing
 * fetched from anywhere, and library media (drashti-media:) allowed only as
 * images and media. The pages phones and tablets open over the local network
 * connect to Drashti's own feed (ws:, which the server's own header narrows
 * to this computer's address) and never name drashti-media: (they get
 * previews over HTTP, by id).
 */

const NETWORK_PAGES = new Set(Object.values(WEB_PAGES));

const RENDERER = join(__dirname, '..', '..', 'renderer');
const pages = readdirSync(RENDERER).filter((f) => f.endsWith('.html'));

function policyOf(html: string): Map<string, string[]> {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  if (!m?.[1]) throw new Error('no Content-Security-Policy meta tag');
  return new Map(
    m[1].split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe('page security policies', () => {
  it('finds the pages', () => {
    expect(pages).toEqual(expect.arrayContaining(['index.html', 'output.html']));
  });

  for (const page of pages.filter((p) => NETWORK_PAGES.has(p))) {
    it(`${page} (for phones): app scripts only, only Drashti's feed, no library media by scheme`, () => {
      const policy = policyOf(readFileSync(join(RENDERER, page), 'utf8'));
      expect(policy.get('default-src')).toEqual(["'self'"]);
      expect(policy.get('script-src')).toEqual(["'self'"]);
      expect(policy.get('connect-src')).toEqual(["'self'", 'ws:']);
      expect(policy.get('object-src')).toEqual(["'none'"]);
      expect(policy.get('base-uri')).toEqual(["'none'"]);
      expect(policy.get('form-action')).toEqual(["'none'"]);
      for (const [name, values] of policy) expect(values, name).not.toContain('drashti-media:');
    });
  }

  // The hidden window that draws a PDF's pages (Session 15): pdf.js's image decoders are
  // WebAssembly, and it plays no media at all.
  it('pdf.html (pictures): app scripts and WebAssembly only, no fetching, no media', () => {
    const policy = policyOf(readFileSync(join(RENDERER, 'pdf.html'), 'utf8'));
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('media-src')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    for (const [name, values] of policy) expect(values, name).not.toContain('drashti-media:');
  });

  for (const page of pages.filter((p) => !NETWORK_PAGES.has(p) && p !== 'pdf.html')) {
    it(`${page}: app scripts only, no fetching, media only as images and media`, () => {
      const policy = policyOf(readFileSync(join(RENDERER, page), 'utf8'));
      expect(policy.get('default-src')).toEqual(["'self'"]);
      expect(policy.get('script-src')).toEqual(["'self'"]);
      expect(policy.get('connect-src')).toEqual(["'self'"]);
      expect(policy.get('object-src')).toEqual(["'none'"]);
      expect(policy.get('base-uri')).toEqual(["'none'"]);
      expect(policy.get('form-action')).toEqual(["'none'"]);
      for (const [name, values] of policy) {
        if (name === 'img-src' || name === 'media-src') continue;
        expect(values, name).not.toContain('drashti-media:');
      }
      expect(policy.get('media-src')).toContain('drashti-media:');
    });
  }
});
