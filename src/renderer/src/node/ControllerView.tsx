import { useEffect } from 'react';
import { ControllerActions } from './ControllerActions';
import type { NodeView } from '../../../shared/nodes';
import type { EngineState, UpNext } from '../../../shared/engine/state';
import { mediaToPreload } from '../../../shared/engine/preload';
import { deckSlideAt } from '../../../shared/deck-show';
import { languageView } from '../../../shared/language-view';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import { nextCaption } from '../../../shared/next-caption';
import { connectEngine, useEngine } from '../engine/engine-store';
import { setClockOffset } from '../render/clock';
import { preloadFonts } from '../render/fonts';
import { LiveHere } from '../render/live-here';
import { watchGpuRestarts, watchMediaReady } from '../render/media-attempts';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { ScreenPictures } from '../render/picture-looks';
import { Scene } from '../render/Scene';
import { SceneBoundary } from '../render/SceneBoundary';
import { SlideView } from '../render/SlideView';
import { useStopFade } from '../render/StopFade';
import { retryFailedStill } from '../render/stills';
import { Badge } from '../ui/Badge';

type SharedView = NonNullable<NodeView['controller']>;

/** Next's picture, using only the files copied to this computer. Inputs and windows stay on Main. */
function NextPicture({
  next,
  state,
  groupId,
}: {
  next: UpNext | null;
  state: EngineState;
  groupId: string | null;
}) {
  const languages = (groupId ? state.look.groups[groupId]?.languages : null) ?? null;
  if (next?.kind === 'slide') {
    const slide = languageView(deckSlideAt(next.slide, next.step ?? 0), languages);
    return (
      <>
        {next.background && (
          <MediaStill
            mediaId={next.background.mediaId}
            media={next.background.media}
            fit={next.background.fit}
          />
        )}
        <PlacedInParent content={slide} mode="fit" className="absolute inset-0">
          <SlideView slide={slide} media="still" />
        </PlacedInParent>
      </>
    );
  }
  if (next?.kind === 'media' && next.media !== 'audio')
    return <MediaStill mediaId={next.mediaId} media={next.media} />;
  return (
    <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm text-white">
      {nextCaption(next)}
    </p>
  );
}

/** The node's existing ordered engine copy, presented as LIVE, NEXT and the coming playlist rows. */
export function ControllerView({ view }: { view: SharedView }) {
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const stop = useStopFade(state?.stopped);
  useEffect(() => {
    connectEngine();
    watchMediaReady();
    watchGpuRestarts();
    void preloadFonts();
    return window.drashti.output.onMediaReady(retryFailedStill);
  }, []);
  useEffect(() => {
    setClockOffset(view.clockOffsetMs);
  }, [view.clockOffsetMs]);
  useEffect(() => {
    if (!view.connected) return;
    for (const media of mediaToPreload(state?.next ?? null)) retryFailedStill(media.mediaId);
  }, [state?.next, view.connected]);
  const canvas = { width: view.canvasWidth, height: view.canvasHeight };
  const look = (view.groupId ? state?.look.groups[view.groupId] : null) ?? DEFAULT_LIVE_GROUP_LOOK;
  const connected = view.connected && state !== null;
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-panel-2 p-3"
      data-testid="controller-view"
      data-rev={String(rev)}
      aria-labelledby="controller-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="controller-title" className="flex-1 text-base font-bold">
          Shared show
        </h2>
        <span role="status" aria-live="polite">
          <Badge tone={connected ? 'success' : 'warning'} data-testid="controller-status">
            {connected ? 'Connected to Main' : 'Not connected'}
          </Badge>
        </span>
      </div>
      <p className="text-xs text-muted">
        {view.areas?.length
          ? 'Main runs the show and checks the controls it allows here.'
          : 'Main runs the show. This computer shows LIVE and NEXT, without show controls.'}
      </p>
      {!connected && (
        <p className="text-sm text-warning-fg">
          {state?.stopped
            ? 'Drashti on Main has stopped.'
            : 'The last view stays here. Check the link to Main; Main keeps running the show.'}
        </p>
      )}
      {state && <ControllerActions view={view} state={state} />}
      {state && (
        <LiveHere.Provider value={false}>
          <ScreenPictures.Provider value={{ pictures: state.pictures, liveZoom: null }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div data-testid="controller-live" className="min-w-0 space-y-1">
                <h3 className="text-xs font-bold text-muted">LIVE · {view.groupName}</h3>
                <div
                  className="relative overflow-hidden rounded-md border border-line bg-black"
                  style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
                  data-a11y-picture
                  aria-hidden="true"
                >
                  <SceneBoundary resetKey={rev}>
                    {!stop.black && (
                      <PlacedInParent content={canvas} mode="fit" className="absolute inset-0">
                        <Scene
                          state={state}
                          canvas={canvas}
                          scaling={view.scaling}
                          look={look}
                          translationGroupId={view.groupId}
                          annotate
                          captions={false}
                        />
                      </PlacedInParent>
                    )}
                    {stop.cover}
                  </SceneBoundary>
                </div>
                <p className="text-xs text-muted">
                  {state.stopped
                    ? 'Main has stopped'
                    : state.blackout
                      ? 'Black-out'
                      : state.wallpaper
                        ? 'Wallpaper'
                        : state.live.slideIndex !== null
                          ? `Slide ${String(state.live.slideIndex + 1)} of ${String(state.live.slideCount)}`
                          : 'No slide up'}
                </p>
                {(state.layers.background?.kind === 'input' ||
                  state.layers.background?.kind === 'window' ||
                  state.layers.background?.kind === 'link') && (
                  <p className="text-xs text-muted">{state.layers.background.name} is on Main.</p>
                )}
              </div>
              <div data-testid="controller-next" className="min-w-0 space-y-1">
                <h3 className="text-xs font-bold text-muted">NEXT</h3>
                <div
                  className="relative overflow-hidden rounded-md border border-line bg-black"
                  style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
                  data-a11y-picture
                  aria-hidden="true"
                >
                  <SceneBoundary resetKey={rev}>
                    <NextPicture next={state.next} state={state} groupId={view.groupId} />
                  </SceneBoundary>
                </div>
                <p className="text-xs text-muted">{nextCaption(state.next)}</p>
              </div>
            </div>
            {state.upcoming.length > 0 && (
              <div className="space-y-1" data-testid="controller-upcoming">
                <h3 className="text-xs font-bold text-muted">Coming up</h3>
                <ol className="list-inside list-decimal text-sm">
                  {state.upcoming.map((item) => (
                    <li key={item.id}>{item.label}</li>
                  ))}
                </ol>
              </div>
            )}
          </ScreenPictures.Provider>
        </LiveHere.Provider>
      )}
    </section>
  );
}
