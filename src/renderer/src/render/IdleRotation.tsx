import type { CSSProperties } from 'react';
import type { IdleItem, IdleState, Quote, QuoteLang } from '../../../shared/idle';
import { idleFrame, QUOTE_LANGS } from '../../../shared/idle';
import { mediaUrl } from '../../../shared/media';
import type { Lang } from '../../../shared/model';
import type { Size } from '../../../shared/scaling';
import { LANG_FONT_STACK } from './fonts';
import { useNow } from './useNow';

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
  opacity,
  languages,
  canvas,
}: {
  item: IdleItem;
  opacity: number;
  languages: readonly Lang[] | null;
  canvas: Size;
}) {
  return (
    <div style={{ ...FULL, opacity }} data-idle-item={item.kind === 'picture' ? item.mediaId : item.quote.id}>
      {item.kind === 'picture' ? (
        <img
          src={mediaUrl(item.mediaId)}
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
  const now = useNow(100);
  const frame = idleFrame(idle, idle.startedAt ?? 0, now);
  if (!frame) return null;
  const current = idle.items[frame.index];
  const next = idle.items[frame.next];
  if (!current) return null;
  return (
    <div data-layer="idle" data-idle-index={frame.index} style={{ ...FULL, background: '#000000' }}>
      <ItemView key={frame.index} item={current} opacity={1} languages={languages} canvas={canvas} />
      {next && frame.next !== frame.index && (
        <ItemView key={frame.next} item={next} opacity={frame.fade} languages={languages} canvas={canvas} />
      )}
    </div>
  );
}
