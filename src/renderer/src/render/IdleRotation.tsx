import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { IdleItem, IdleState, Quote, QuoteLang } from '../../../shared/idle';
import { idleFrame, QUOTE_LANGS } from '../../../shared/idle';
import { mediaUrl } from '../../../shared/media';
import type { Lang } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import { LANG_FONT_STACK } from './fonts';
import { useMediaAttempt } from './media-attempts';
import { useNow } from './useNow';
import { engineNow } from './clock';
import { EASE } from './easing';

/*
 * The idle rotation on a screen (shared/idle.ts): the item up and the next
 * one dissolving in over it, worked out from the engine's clock so every
 * screen is in step. Pictures are shown whole on black; a quote shows its
 * words in the group's languages (each language's own font) with its
 * attribution under them. The next item is already drawn (unseen) so a
 * picture is loaded before it dissolves in.
 */

const FULL: CSSProperties = { position: 'absolute', inset: 0 };

/** A quote's languages on these screens: the group's, in its order, else all of them. */
function quoteLangs(quote: Quote, languages: readonly Lang[] | null): QuoteLang[] {
  const order: readonly string[] = languages ?? QUOTE_LANGS;
  const chosen = order.filter((l): l is QuoteLang => (QUOTE_LANGS as readonly string[]).includes(l));
  const shown = chosen.filter((l) => quote.words[l] !== undefined);
  // A group whose languages the quote does not have: its words anyway, rather than nothing.
  return shown.length > 0 ? shown : QUOTE_LANGS.filter((l) => quote.words[l] !== undefined);
}

export function QuoteView({
  quote,
  languages,
  size,
}: {
  quote: Quote;
  languages: readonly Lang[] | null;
  /** The words' size in pixels. */
  size: number;
}) {
  return (
    <div
      style={{
        ...FULL,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: size * 0.6,
        padding: `0 ${String(size * 2)}px`,
        color: '#ffffff',
        textAlign: 'center',
        lineHeight: 1.35,
      }}
    >
      {quoteLangs(quote, languages).map((l) => (
        <p
          key={l}
          lang={l}
          data-quote-lang={l}
          style={{ margin: 0, fontSize: size, fontFamily: LANG_FONT_STACK[l], whiteSpace: 'pre-wrap' }}
        >
          {quote.words[l]}
        </p>
      ))}
      {quote.attribution !== '' && (
        <p style={{ margin: 0, fontSize: size * 0.6, color: '#c9ced8', fontFamily: LANG_FONT_STACK.default }}>
          — {quote.attribution}
        </p>
      )}
    </div>
  );
}

function ItemView({
  item,
  role,
  languages,
  canvas,
}: {
  item: IdleItem;
  /** The item up, or the next one dissolving in over it (added light for light). */
  role: 'current' | 'next';
  languages: readonly Lang[] | null;
  canvas: Size;
}) {
  // On a node, a picture whose copy landed after it was asked for is drawn again (a new element).
  const attempt = useMediaAttempt(item.kind === 'picture' ? item.mediaId : '');
  return (
    <div
      // Its opacity is the dissolve's, set frame by frame (IdleRotation); the next one starts unseen.
      style={{
        ...FULL,
        opacity: role === 'next' ? 0 : undefined,
        mixBlendMode: role === 'next' ? 'plus-lighter' : undefined,
      }}
      data-idle-role={role}
      data-idle-item={item.kind === 'picture' ? item.mediaId : item.quote.id}
    >
      {item.kind === 'picture' ? (
        <img
          key={attempt}
          src={mediaUrl(item.mediaId, attempt)}
          alt=""
          draggable={false}
          style={{ ...FULL, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <QuoteView quote={item.quote} languages={languages} size={Math.round(canvas.height * 0.05)} />
      )}
    </div>
  );
}

export function IdleRotation({
  idle,
  languages,
  canvas,
}: {
  idle: IdleState;
  languages: readonly Lang[] | null;
  canvas: Size;
}) {
  // Which items are up, drawn again as the rotation steps on (a tenth of a second late at most, when the
  // incoming item is already whole); the dissolve itself is drawn frame by frame below.
  const now = useNow(100);
  const anchor = idle.startedAt ?? 0;
  const frame = idleFrame(idle, anchor, now);
  const rootRef = useRef<HTMLDivElement>(null);
  // What is drawn, for the frame-by-frame painting: read at every frame, so a frame asked for before a
  // drawing never paints that drawing's items with an older one's times.
  const drawn = useRef({ idle, anchor });
  const raf = useRef(0);
  // A complementary dissolve (Session 27, the skills review's MOT-8), on smoothstep by the engine's clock:
  // the old item goes out as the new one comes in, added light for light in a group of their own over
  // black, so the picture neither dips nor pops when the old item is taken away. True while it dissolves,
  // or is about to: painted again at the next frame.
  const paint = useCallback((): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const { idle, anchor } = drawn.current;
    const index = Number(root.dataset['idleIndex']);
    const t = engineNow();
    const f = idleFrame(idle, anchor, t);
    // A step on since this was drawn: the incoming item whole, until it is drawn as the one up.
    const e = !f ? 0 : f.index === index ? EASE.smooth(f.fade) : 1;
    for (const el of root.querySelectorAll<HTMLElement>('[data-idle-role]'))
      el.style.opacity = String(el.dataset['idleRole'] === 'next' ? e : 1 - e);
    return f?.index === index && (f.fade > 0 || (idleFrame(idle, anchor, t + 150)?.fade ?? 0) > 0);
  }, []);
  // Painted after every drawing, before it is shown; then frame by frame only while it dissolves (a
  // drawing every tenth of a second, above, starts that from just before the dissolve).
  useLayoutEffect(() => {
    drawn.current = { idle, anchor };
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
  const current = idle.items[frame.index];
  const next = idle.items[frame.next];
  if (!current) return null;
  return (
    <div
      ref={rootRef}
      data-layer="idle"
      data-idle-index={frame.index}
      style={{ ...FULL, background: '#000000', isolation: 'isolate' }}
    >
      <ItemView key={frame.index} item={current} role="current" languages={languages} canvas={canvas} />
      {next && frame.next !== frame.index && (
        <ItemView key={frame.next} item={next} role="next" languages={languages} canvas={canvas} />
      )}
    </div>
  );
}
