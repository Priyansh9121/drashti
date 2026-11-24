import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The pictures' clock on each page (a22-x86sync, QA23-X86SYNC-1, lead 2's condition 3): only the stream's picture page
 * puts its pictures on its silent graph (render/playback.ts setPictureClock, render/cue-clock.ts StreamPictureClock);
 * the hall's screens, LIVE, the stage, the display copies and a paired computer's pages play their pictures as before.
 */

const RENDERER = join(__dirname, '..', 'renderer');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe("the pictures' clock on each page (a22-x86sync)", () => {
  it("is set only by the stream's picture page", () => {
    const setters = sources(join(RENDERER, 'src'))
      .filter((file) => /\bsetPictureClock\(/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(join(RENDERER, 'src'), file).split(sep).join('/'))
      .sort();
    expect(setters).toEqual(['program/main.tsx', 'render/playback.ts']);
  });

  it("whose entry, program/main.tsx, is the stream page's alone (stream.html), never an output's", () => {
    const entries = readdirSync(RENDERER)
      .filter((name) => name.endsWith('.html'))
      .filter((name) => readFileSync(join(RENDERER, name), 'utf8').includes('src/program/main.tsx'));
    expect(entries).toEqual(['stream.html']);
  });
});
