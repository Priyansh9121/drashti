import { useEffect, useMemo, useState } from 'react';
import { groupLookIn } from '../../../../shared/looks';
import { type HallPicture, hallPictureSchema } from '../../../../shared/stage-layouts';
import { useEngine } from '../../engine/engine-store';
import { preloadFonts } from '../../render/fonts';
import { PlacedInParent } from '../../render/Placed';
import { PreviewsContext } from '../../render/previews';
import { StageScreen } from '../../render/StageScreen';
import { api } from '../device';
import { onListsChanged, onOnline, startFeed, useFeed } from '../feed';
import { networkPreviews } from '../previews';
import { ClockStyleContext } from '../../render/clock-style';
import { type ClockStyle, validClockStyle } from '../../../../shared/format';
import { useStopFade } from '../../render/StopFade';
import { PhoneStopped } from '../Stopped';

/*
 * The stage display in a browser (a Stage device: a tablet on the stage, a
 * TV's browser): exactly what a stage screen shows, drawn by the same
 * StageView from the same state, as the first stage group shows it in the
 * live Look (a Look switch reaches it at once, through the feed), with the
 * engine's clock. Watch-only. While the connection is down it keeps the
 * last picture, as an output does, and says so in a small line; it
 * reconnects by itself.
 *
 * A layout's audience picture box (Session 51) draws the hall as Drashti's own
 * stage screens draw it (its group and canvas, and Audience off, from the
 * stage's answer), as the phone remote's live picture does: pictures and
 * videos as the same small previews, under the same rules, and no video input
 * or window, which are on Drashti's computer. With no audience group at all
 * it says so (Session 52), and until the answer comes it is black alone.
 */

const CANVAS = { width: 1920, height: 1080 };

export function StageDisplay() {
  const state = useEngine((s) => s.state);
  const feed = useFeed((s) => s.state);
  const [fonts, setFonts] = useState(false);
  // The stage display's group: what it shows is that group's settings in the live Look (engine state).
  const [groupId, setGroupId] = useState<string | null>(null);
  const look = groupLookIn(state?.look, groupId);
  const [clockStyle, setClockStyle] = useState<ClockStyle | null>(null);
  // The hall's picture for a layout's audience picture box (Session 51); null with no audience group, which the
  // box says (Session 52), and undefined until said: the box is black alone, never said to have none.
  const [hall, setHall] = useState<HallPicture | null | undefined>(undefined);
  const previews = useMemo(() => networkPreviews(), []);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    void preloadFonts().then(() => {
      setFonts(true);
    });
    const load = () => {
      void api<{ groupId: string | null; clock: unknown; hall?: unknown }>('/api/v1/stage').then((r) => {
        if (!r.ok) return;
        setGroupId(r.groupId);
        setClockStyle(validClockStyle(r.clock));
        // The hall, or null with none; an answer that says neither changes nothing.
        const read = hallPictureSchema.nullable().safeParse(r.hall);
        if (read.success) setHall(read.data);
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
  // Drashti stopped (Session 54): black, as its stage screens go, and said plainly (PhoneStopped).
  const stop = useStopFade(state?.stopped);
  return (
    <div className="relative h-dvh w-full bg-black" data-testid="stage-display" data-connection={feed}>
      {state && fonts && !stop.black ? (
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          {/* Drashti's way of writing the time (Sessions 31–36, I18N-8), its timers' clocks too. */}
          <ClockStyleContext.Provider value={clockStyle}>
            <PreviewsContext.Provider value={previews}>
              <StageScreen state={state} look={look} canvas={CANVAS} clockStyle={clockStyle} hall={hall} />
            </PreviewsContext.Provider>
          </ClockStyleContext.Provider>
        </PlacedInParent>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center text-2xl text-muted">
          Connecting to Drashti…
        </p>
      )}
      {stop.cover}
      <PhoneStopped />
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
