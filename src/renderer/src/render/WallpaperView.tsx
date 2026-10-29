import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChosenWallpaper } from '../../../shared/wallpapers';
import { wallpaperFrame } from '../../../shared/wallpapers';
import { engineNow } from './clock';
import { EASE } from './easing';
import { useMediaAttempt } from './media-attempts';
import { useMediaUrl } from './media-urls';
import { Looked } from './picture-looks';
import { PreviewPicture, usePreviewsOnly } from './previews';
import { useNow } from './useNow';

/*
 * The chosen wallpaper on a screen (Session 55, Part 6; render/NothingUp.tsx draws it whenever nothing is up, and under
 * the Wallpaper): its picture shown whole on black, each with its look (the Picture editor's, as everywhere it shows);
 * several go round, each up for its seconds and fading into the next, worked out from the engine's clock so every
 * screen, node and phone is in step. The next picture is already drawn (unseen), so it is loaded before it fades in.
 */

const FULL: CSSProperties = { position: 'absolute', inset: 0 };
const PICTURE: CSSProperties = { ...FULL, width: '100%', height: '100%', objectFit: 'contain' };

function Picture({ mediaId, role }: { mediaId: string; role: 'current' | 'next' }) {
  // On a node, a picture whose copy landed after it was asked for is drawn again (a new element).
  const attempt = useMediaAttempt(mediaId);
  const urlOf = useMediaUrl();
  const previews = usePreviewsOnly();
  return (
    <div
      // Its opacity is the fade's, set frame by frame (WallpaperView); the next one starts unseen.
      style={{
        ...FULL,
        opacity: role === 'next' ? 0 : undefined,
        mixBlendMode: role === 'next' ? 'plus-lighter' : undefined,
      }}
      data-testid="wallpaper-picture"
      data-wallpaper-role={role}
      data-media-id={mediaId}
    >
      {previews ? (
        <PreviewPicture mediaId={mediaId} style={PICTURE} />
      ) : (
        <Looked mediaId={mediaId} showing={null} style={PICTURE}>
          {(s, copy) => (
            <img
              key={attempt}
              src={copy?.url ?? urlOf(mediaId, attempt)}
              alt=""
              draggable={false}
              style={s}
            />
          )}
        </Looked>
      )}
    </div>
  );
}

export function WallpaperView({ wallpaper }: { wallpaper: ChosenWallpaper }) {
  // Which pictures are up, drawn again as it steps on (a tenth of a second late at most, when the incoming picture is
  // already whole); the fade itself is painted frame by frame below.
  const now = useNow(wallpaper.pictures.length > 1 ? 100 : 60_000);
  const frame = wallpaperFrame(wallpaper, now);
  const rootRef = useRef<HTMLDivElement>(null);
  // What is drawn, for the frame-by-frame painting: read at every frame, so a frame asked for before a drawing never
  // paints that drawing's pictures with an older one's times.
  const drawn = useRef(wallpaper);
  const raf = useRef(0);
  // A complementary fade (as the idle rotation's was, Session 27): the old picture goes out as the new one comes in,
  // added light for light over black in a group of their own, so the picture neither dips nor pops. True while it
  // fades, or is about to: painted again at the next frame.
  const paint = useCallback((): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const w = drawn.current;
    const index = Number(root.dataset['wallpaperIndex']);
    const t = engineNow();
    const f = wallpaperFrame(w, t);
    // A step on since this was drawn: the incoming picture whole, until it is drawn as the one up.
    const e = !f ? 0 : f.index === index ? EASE.smooth(f.fade) : 1;
    for (const el of root.querySelectorAll<HTMLElement>('[data-wallpaper-role]'))
      el.style.opacity = String(el.dataset['wallpaperRole'] === 'next' ? e : 1 - e);
    return f?.index === index && (f.fade > 0 || (wallpaperFrame(w, t + 150)?.fade ?? 0) > 0);
  }, []);
  useLayoutEffect(() => {
    drawn.current = wallpaper;
    cancelAnimationFrame(raf.current);
    const tick = () => {
      raf.current = paint() ? requestAnimationFrame(tick) : 0;
    };
    tick();
  });
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
    },
    [],
  );
  if (!frame) return null;
  const current = wallpaper.pictures[frame.index];
  const next = wallpaper.pictures[frame.next];
  if (current === undefined) return null;
  return (
    <div
      ref={rootRef}
      data-layer="wallpaper-picture"
      data-wallpaper={wallpaper.id}
      data-wallpaper-index={frame.index}
      style={{ ...FULL, background: '#000000', isolation: 'isolate' }}
    >
      <Picture key={`${String(frame.index)}:${current}`} mediaId={current} role="current" />
      {next !== undefined && frame.next !== frame.index && (
        <Picture key={`${String(frame.next)}:${next}`} mediaId={next} role="next" />
      )}
    </div>
  );
}
