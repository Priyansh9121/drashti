import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeZip } from '../testing/zip-writer';
import { readZipEntries } from '../zip';
import { deadLinks, NO_FILE, withoutOutsideLinks } from './links';

/* A deck a phone sent (Session 54, C review): its links to files outside it made dead ends, its hyperlinks kept. */

const dir = mkdtempSync(join(tmpdir(), 'drashti-links-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="file:///Users/placeholder/Private%20clip.mp4" TargetMode="External"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="/Users/placeholder/Private.png"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/placeholder" TargetMode="External"/></Relationships>`;

describe('a deck a phone sent', () => {
  it('has every link to a file outside it made a dead end, its parts and hyperlinks as they were', () => {
    const { xml, count } = deadLinks(RELS);
    expect(count).toBe(2);
    expect(xml).not.toContain('Private');
    expect(xml.match(new RegExp(`Target="${NO_FILE}"`, 'gu'))).toHaveLength(2);
    expect(xml).toContain('Target="../slideLayouts/slideLayout1.xml"');
    expect(xml).toContain('Target="https://example.com/placeholder"');
  });

  it('is copied with its dead links, every other part as it was', async () => {
    const deck = join(dir, 'Placeholder sent.pptx');
    writeFileSync(
      deck,
      makeZip([
        { name: 'ppt/slides/_rels/slide1.xml.rels', data: RELS, deflate: true },
        { name: 'ppt/slides/slide1.xml', data: '<p:sld/>', deflate: true },
      ]),
    );
    const copy = join(dir, 'Placeholder sent copy.pptx');
    expect(await withoutOutsideLinks(deck, copy)).toBe(2);
    const parts = await readZipEntries(copy, () => true);
    expect(parts.get('ppt/slides/_rels/slide1.xml.rels')?.toString('utf8')).toBe(deadLinks(RELS).xml);
    expect(parts.get('ppt/slides/slide1.xml')?.toString('utf8')).toBe('<p:sld/>');
  });
});
