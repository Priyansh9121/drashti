import { useEffect, useState } from 'react';
import type { Lang } from '../../../../shared/model';
import { useEngine } from '../../engine/engine-store';
import { preloadFonts } from '../../render/fonts';
import { PlacedInParent } from '../../render/Placed';
import { StageView } from '../../render/StageView';
import { api } from '../device';
import { onListsChanged, onOnline, startFeed, useFeed } from '../feed';

/*
 * The stage display in a browser (a Stage device: a tablet on the stage, a
 * TV's browser): exactly what a stage screen shows, drawn by the same
 * StageView from the same state, in the stage group's languages, with the
 * engine's clock. Watch-only. While the connection is down it keeps the
 * last picture, as an output does, and says so in a small line; it
 * reconnects by itself.
 */

const CANVAS = { width: 1920, height: 1080 };

export function StageDisplay() {
  const state = useEngine((s) => s.state);
  const feed = useFeed((s) => s.state);
  const [fonts, setFonts] = useState(false);
  const [languages, setLanguages] = useState<Lang[] | null>(null);
  const [clockStyle, setClockStyle] = useState<{ locale: string; timeZone: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    void preloadFonts().then(() => {
      setFonts(true);
    });
    const load = () => {
      void api<{ languages: Lang[] | null; clock: { locale: string; timeZone: string } }>(
        '/api/v1/stage',
      ).then((r) => {
        if (!r.ok) return;
        setLanguages(r.languages);
        setClockStyle(r.clock);
      });
    };
    onOnline(load);
    onListsChanged((what) => {
      if (what === 'screens') load();
    });
    startFeed();
    const onChange = () => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);
  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function';
  return (
    <div className="relative h-dvh w-full bg-black" data-testid="stage-display" data-connection={feed}>
      {state && fonts ? (
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          <StageView state={state} languages={languages} clockStyle={clockStyle} />
        </PlacedInParent>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center text-2xl text-muted">
          Connecting to Drashti…
        </p>
      )}
      {feed !== 'online' && state && (
        <p
          role="status"
          className="absolute right-3 bottom-3 rounded-md bg-warning-bg px-3 py-1 text-base text-warning-fg"
          data-testid="stage-offline"
        >
          Not connected to Drashti: showing the last picture, trying again…
        </p>
      )}
      {canFullscreen && !fullscreen && (
        <button
          type="button"
          onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
          className="absolute top-3 right-3 min-h-11 rounded-md border border-line-strong bg-panel-2/80 px-3 text-base text-fg"
        >
          Full screen
        </button>
      )}
    </div>
  );
}
