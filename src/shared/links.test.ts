import { describe, expect, it } from 'vitest';
import { checkLink, downloadHostAllowed } from './links';

/*
 * Made-up links only (PLAN §6): no real Dropbox file or folder is named here.
 */

const FILE =
  'https://www.dropbox.com/scl/fi/abc123placeholder/Placeholder%20clip.mp4?rlkey=placeholderkey&dl=0';
const FOLDER = 'https://www.dropbox.com/scl/fo/abc123placeholder/def456placeholder?rlkey=placeholderkey&dl=0';

const ok = (r: ReturnType<typeof checkLink>) => (r.ok ? r : null);
const message = (r: ReturnType<typeof checkLink>) => (r.ok ? '' : r.message);

describe('checking a pasted Dropbox link', () => {
  it('takes a link to a file, and asks Dropbox for the file itself (dl=1)', () => {
    const r = ok(checkLink('dropbox', FILE));
    expect(r?.shape).toBe('file');
    const url = new URL(r?.url ?? '');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('www.dropbox.com');
    expect(url.searchParams.getAll('dl')).toEqual(['1']);
    expect(url.searchParams.get('rlkey')).toBe('placeholderkey');
  });

  it('takes a link to a folder (it comes as a zip)', () => {
    expect(ok(checkLink('dropbox', FOLDER))?.shape).toBe('folder');
  });

  it('takes the older forms of shared links, and spaces around a pasted link', () => {
    expect(
      ok(checkLink('dropbox', '  https://www.dropbox.com/s/abc123placeholder/Placeholder.pptx?dl=0 \n'))
        ?.shape,
    ).toBe('file');
    expect(
      ok(checkLink('dropbox', 'https://dropbox.com/sh/abc123placeholder/def456placeholder'))?.shape,
    ).toBe('folder');
  });

  it('drops raw=1, which would show the file instead of downloading it', () => {
    const r = ok(checkLink('dropbox', FILE.replace('dl=0', 'raw=1')));
    const url = new URL(r?.url ?? '');
    expect(url.searchParams.has('raw')).toBe(false);
    expect(url.searchParams.get('dl')).toBe('1');
  });

  it('refuses anything but https', () => {
    expect(message(checkLink('dropbox', FILE.replace('https:', 'http:')))).toMatch(/https/u);
    expect(message(checkLink('dropbox', 'ftp://www.dropbox.com/s/abc/x.mp4'))).toMatch(/https/u);
  });

  it("refuses addresses that are not Dropbox's own", () => {
    for (const bad of [
      'https://www.dropbox.com.example.net/scl/fi/abc/x.mp4',
      'https://example.net/www.dropbox.com/scl/fi/abc/x.mp4',
      'https://www.dropbox.com@example.net/scl/fi/abc/x.mp4',
      'https://user:secret@www.dropbox.com/scl/fi/abc/x.mp4',
      'https://www.dropbox.com:8443/scl/fi/abc/x.mp4',
      'https://dl.dropboxusercontent.com/scl/fi/abc/x.mp4',
      'https://127.0.0.1/scl/fi/abc/x.mp4',
    ])
      expect(message(checkLink('dropbox', bad)), bad).not.toBe('');
    expect(message(checkLink('dropbox', 'https://example.net/x.mp4'))).toMatch(/not a Dropbox link/u);
  });

  it('says plainly when a YouTube link was pasted under Dropbox', () => {
    expect(message(checkLink('dropbox', 'https://www.youtube.com/watch?v=AAAAAAAAAAA'))).toMatch(
      /YouTube link/u,
    );
  });

  it('refuses Dropbox pages that are not a shared file or folder', () => {
    expect(message(checkLink('dropbox', 'https://www.dropbox.com/home'))).toMatch(/Copy link/u);
    expect(message(checkLink('dropbox', 'https://www.dropbox.com/scl/fi/'))).toMatch(/Copy link/u);
  });

  it('says what to do with an empty box, words that are not a link, and a link far too long', () => {
    expect(message(checkLink('dropbox', ''))).toMatch(/Paste/u);
    expect(message(checkLink('dropbox', 'placeholder words'))).toMatch(/not a link/u);
    expect(message(checkLink('dropbox', `${FILE}&x=${'a'.repeat(3000)}`))).toMatch(/too long/u);
  });

  it('never offers YouTube yet (it waits for a decision)', () => {
    expect(message(checkLink('youtube', 'https://www.youtube.com/watch?v=AAAAAAAAAAA'))).toMatch(/YouTube/u);
  });
});

describe('where a Dropbox download may be sent on to', () => {
  it("allows only https to Dropbox's own addresses", () => {
    expect(downloadHostAllowed('https://www.dropbox.com/scl/fi/abc/x.mp4?dl=1')).toBe(true);
    expect(downloadHostAllowed('https://uc0placeholder.dl.dropboxusercontent.com/cd/0/get/x/file')).toBe(
      true,
    );
    expect(downloadHostAllowed('https://dl.dropboxusercontent.com/x')).toBe(true);
  });

  it('refuses http, other hosts and look-alikes', () => {
    for (const bad of [
      'http://uc0.dl.dropboxusercontent.com/x',
      'https://dropboxusercontent.com.example.net/x',
      'https://example.net/dropbox.com',
      'https://evildropbox.com/x',
      'https://10.0.0.1/x',
      'https://user@www.dropbox.com/x',
      'not a link',
    ])
      expect(downloadHostAllowed(bad), bad).toBe(false);
  });
});
