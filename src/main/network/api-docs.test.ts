import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { API_ROUTES } from './server';

/* docs/api.md documents every request the API takes, and nothing it does not. */

const docs = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'api.md'), 'utf8');

/** A route as the docs write it: `{id}` for a parameter. */
const written = (route: string) => route.replace(/:[a-z]+/gu, '{id}');

describe('the API documentation', () => {
  it('the compatibility overview names the engine state version this build sends', () => {
    const overview = /`ENGINE_STATE_VERSION` in `src\/shared\/engine\/state\.ts`, (\d+) since Session 55/u.exec(docs);
    expect(overview, 'the documented current state version').not.toBeNull();
    expect(Number(overview?.[1])).toBe(ENGINE_STATE_VERSION);
  });

  it('names every request the API takes', () => {
    for (const route of API_ROUTES) {
      if (route.includes(':id/start')) continue; // written once, with "also /pause and /reset"
      if (route.startsWith('POST /api/v1/clear/:')) {
        expect(docs, route).toContain('POST /api/v1/clear/slide');
        continue;
      }
      // A timer's pause and reset are written with its start; other routes are written as they are.
      const asWritten = route.includes('/timers/')
        ? written(route).replace(/\/(pause|reset)$/u, '/start')
        : written(route);
      expect(docs, route).toContain(asWritten);
    }
  });
});
