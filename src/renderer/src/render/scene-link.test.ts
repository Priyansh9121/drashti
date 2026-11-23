import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../shared/engine/state';
import { Scene } from './Scene';

/*
 * A stream link as the background (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A) is the hall's alone:
 * the hall's screens and LIVE draw its player; Drashti's own stream draws the Wallpaper over everything while one is up
 * and nothing of the link (someone else's webcast never goes out again); a key and fill pair has nothing of it to key.
 * Rendered here without a page: nothing loads, only what each draws is read.
 */

function withLink(): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'link',
        linkId: '00000000-0000-4000-8000-000000000001',
        name: 'media.example.org',
        startedAt: 1,
      },
    },
  };
}

const drawn = (place: 'hall' | 'stream', matte: 'fill' | 'key' | null = null) =>
  renderToStaticMarkup(
    createElement(Scene, {
      state: withLink(),
      canvas: { width: 1920, height: 1080 },
      scaling: 'fit',
      place,
      matte,
    }),
  );

describe('a stream link on the screens (alpha.20)', () => {
  it('the hall’s screens draw its player, under no Wallpaper', () => {
    const html = drawn('hall');
    expect(html).toContain('data-kind="link"');
    expect(html).not.toContain('data-testid="wallpaper"');
  });

  it('Drashti’s own stream draws the Wallpaper over everything and nothing of the link', () => {
    const html = drawn('stream');
    expect(html).not.toContain('data-kind="link"');
    expect(html).toContain('data-testid="wallpaper"');
  });

  it('a key and fill pair draws nothing of it', () => {
    for (const matte of ['fill', 'key'] as const)
      expect(drawn('hall', matte), matte).not.toContain('data-kind="link"');
  });
});
