import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from './database';
import { PresentationRepo, DbSlideSource } from './presentations';
import { checkTranslation, draftTranslation } from '../../shared/prepared-translations';
import { LYRICS_STYLE } from '../import/formats/text';

it('keeps checked prepared words across a real SQLite close/reopen, while old presentations remain Off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-prepared-restart-'));
  const file = join(dir, 'placeholder.sqlite');
  let db = openDatabase(file);
  try {
    let repo = new PresentationRepo(db);
    const libraryId = repo.ensureLibrary('Placeholder');
    const source = 'Blue box.';
    const id = repo.insert({
      libraryId,
      name: 'Placeholder prepared',
      groups: [
        {
          name: 'One',
          slides: [
            {
              elements: [
                {
                  id: 'e',
                  kind: 'text',
                  text: source,
                  lang: 'en',
                  frame: { x: 100, y: 100, width: 1500, height: 100 },
                  style: LYRICS_STYLE,
                  translations: [
                    checkTranslation(
                      draftTranslation(source, 'en', 'gu', 'Placeholder Q7'),
                      source,
                      'Reader Q',
                    ),
                  ],
                  translationDisplay: {
                    choice: 'gu',
                    groups: {},
                    outputs: {},
                    area: { x: 100, y: 220, width: 1500, height: 150 },
                    fontSize: 48,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const old = repo.insert({
      libraryId,
      name: 'Placeholder existing',
      groups: [{ name: 'One', slides: [{ elements: [] }] }],
    });
    db.close();
    db = openDatabase(file);
    repo = new PresentationRepo(db);
    const output = new DbSlideSource(repo).order(id)?.slides[0]?.slide.elements[0];
    expect(output).toMatchObject({
      text: source,
      translations: [{ text: 'Placeholder Q7', state: 'checked' }],
      translationDisplay: { choice: 'gu' },
    });
    expect(new DbSlideSource(repo).order(old)?.slides[0]?.slide.elements).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
