import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LinkBackground } from '../../../shared/engine/state';
import { PICTURE_LIMITS } from '../../../shared/media';
import { startLivePlayback } from './live-playback';
import { useLiveHere } from './live-here';
import { usePreviewsOnly } from './previews';

/*
 * A stream link as the background (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A): the main process's
 * short local copy of it (src/main/live-link/), played muted (its sound is the audio player's) and fitted inside the
 * screen with black around it, joined with every other page at the same frame at the same moment (render/
 * live-playback.ts). While the link drops, the screen keeps its last picture, never black: a player waiting for more
 * shows the frame it has. When it must join again (every page starting again together after a drop, or this one alone
 * fallen behind) a new player loads and plays under the one shown, which stays over it until the new one plays; a
 * player that gives up leaves its last picture on a canvas over the joining one meanwhile. The screen is told when its first picture is
 * drawn (Scene keeps what was there, or the Wallpaper, until then). Drawn on this computer's own pages only: never on a
 * phone or tablet (previews only), nor a node's screen (the link is received on Main's computer).
 */

const FITTED: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

/** How long after a player gives up a new one joins. */
const AGAIN_MS = 1000;

/** What Scene compares to know whether this link is drawn yet: the link, whatever start its pages are on. */
export const linkKey = (layer: Pick<LinkBackground, 'linkId'>): string => `link:${layer.linkId}`;

type LinkState = 'loading' | 'live' | 'held';

interface Player {
  el: HTMLVideoElement;
  stop: () => void;
}

/** A link's players in one screen's box: the one shown, and the one joining (see above). */
class LinkPlayers {
  private shown: Player | null = null;
  private incoming: Player | null = null;
  private off = false;
  private again: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly kept: HTMLCanvasElement,
    private readonly linkId: string,
    private readonly told: (state: LinkState, drawn: boolean) => void,
  ) {}

  /** Join (again): a new player, the one shown kept until its first frame. */
  join(): void {
    if (this.off) return;
    if (this.incoming) this.drop(this.incoming);
    this.incoming = this.make();
  }

  close(): void {
    this.off = true;
    if (this.again) clearTimeout(this.again);
    if (this.incoming) this.drop(this.incoming);
    if (this.shown) this.drop(this.shown);
    this.incoming = null;
    this.shown = null;
  }

  private drop(player: Player): void {
    player.stop();
    player.el.remove();
  }

  /** The shown player's last picture, kept on the canvas under it. */
  private keep(): void {
    const v = this.shown?.el;
    if (!v || v.videoWidth === 0) return;
    this.kept.width = v.videoWidth;
    this.kept.height = v.videoHeight;
    this.kept.getContext('2d')?.drawImage(v, 0, 0);
  }

  private make(): Player {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.disablePictureInPicture = true;
    el.crossOrigin = 'anonymous';
    // Joining, it plays under the one shown and the kept picture (a player kept unseen may never play: x54-1120-205049-94352),
    // and comes over them once it plays.
    Object.assign(el.style, FITTED, { zIndex: '0' });
    this.root.appendChild(el);
    const player: Player = { el, stop: () => undefined };
    player.stop = startLivePlayback(el, {
      linkId: this.linkId,
      audible: false,
      limits: PICTURE_LIMITS,
      onFrame: () => {
        if (this.off || this.incoming !== player) return;
        el.style.zIndex = '2';
        // For the tests: the player shown.
        el.dataset['shown'] = '1';
        if (this.shown) this.drop(this.shown);
        this.kept.getContext('2d')?.clearRect(0, 0, this.kept.width, this.kept.height);
        this.shown = player;
        this.incoming = null;
        this.told('live', true);
      },
      onBehind: () => {
        if (this.shown === player) this.join();
      },
      onError: () => {
        if (this.off) return;
        if (this.shown === player) {
          // Its last picture on the canvas, and the player that gave up out of sight over it.
          this.keep();
          el.style.visibility = 'hidden';
          this.told('held', true);
        }
        if (this.again) return;
        // eslint-disable-next-line no-restricted-syntax -- only starts a new player: what it shows and when is the engine's time (live-playback.ts)
        this.again = setTimeout(() => {
          this.again = null;
          this.join();
        }, AGAIN_MS);
      },
    });
    // Waiting for more of the link (it dropped): the frame it has stays shown.
    el.addEventListener('waiting', () => {
      if (this.shown === player) this.told('held', true);
    });
    el.addEventListener('playing', () => {
      if (this.shown === player) this.told('live', true);
    });
    return player;
  }
}

export function LinkView({
  layer,
  onDrawn,
}: {
  layer: LinkBackground;
  /** Told once its first picture is drawn (its key), and as it goes (null). */
  onDrawn?: ((key: string | null) => void) | undefined;
}) {
  const previews = usePreviewsOnly();
  const here = useLiveHere();
  if (previews || !here) return null;
  return <LinkPicture key={linkKey(layer)} layer={layer} onDrawn={onDrawn} />;
}

function LinkPicture({
  layer,
  onDrawn,
}: {
  layer: LinkBackground;
  onDrawn?: ((key: string | null) => void) | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const kept = useRef<HTMLCanvasElement>(null);
  const players = useRef<LinkPlayers | null>(null);
  const [state, setState] = useState<LinkState>('loading');
  const key = linkKey(layer);
  const tell = useRef(onDrawn);
  useLayoutEffect(() => {
    tell.current = onDrawn;
  });
  // As it goes, the screen no longer has it drawn.
  useLayoutEffect(
    () => () => {
      tell.current?.(null);
    },
    [],
  );
  useEffect(() => {
    const root = box.current;
    const canvas = kept.current;
    if (!root || !canvas) return;
    const made = new LinkPlayers(root, canvas, layer.linkId, (next, drawn) => {
      setState(next);
      if (drawn) tell.current?.(key);
    });
    players.current = made;
    return () => {
      made.close();
      players.current = null;
    };
  }, [layer.linkId, key]);
  // Each start of the showing (as it went up, and each time every page starts again together): join it.
  useEffect(() => {
    players.current?.join();
  }, [layer.startedAt]);
  return (
    <div
      ref={box}
      data-layer="background"
      data-kind="link"
      data-link-state={state}
      style={{ position: 'absolute', inset: 0, background: '#000000' }}
    >
      <canvas
        ref={kept}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          zIndex: 1,
        }}
      />
    </div>
  );
}
