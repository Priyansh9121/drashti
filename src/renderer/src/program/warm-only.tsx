import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/fonts.css';
import '../styles/app.css';
import { preloadFonts } from '../render/fonts';
import { PlacedInParent } from '../render/Placed';
import { WarmUp } from '../render/WarmUp';
import { reportRenderError } from '../ui/render-errors';

/*
 * The stream's page's warm-up, alone, at Drashti's start (Session 59, X21; C19's finding, C25): the stream's page is
 * drawn off screen in a window of its own kind, and the drawing pipelines its warm-up makes are its own. Made on air
 * (the Stream panel's preview opened while a deck plays), each one held the graphics chip, and the hall's screens'
 * frames stalled with it (CI's Mac: 0.5-2.3 s). So Main opens this page once at the start, in a window like the
 * stream's (stream/program-window.ts), when nothing is on air: it draws the same warm-up as the stream's page, under
 * the same black, and says when it is done; Main then closes it. The chip keeps the pipelines for every window after,
 * so the stream's page, opened later, makes none. It captures nothing, opens no camera or microphone, and sends nothing
 * anywhere.
 */

const CANVAS = { width: 1920, height: 1080 };
/** What Main's window reads in this page's log: its warm-up is over. */
const DONE = '[stream-warm] done';

function WarmOnly() {
  const [fontsReady, setFontsReady] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    void preloadFonts().then(() => {
      setFontsReady(true);
    });
  }, []);
  const done = useCallback(() => {
    setOver(true);
    console.info(DONE);
  }, []);
  return (
    <div
      className="relative h-full w-full bg-black"
      data-testid="stream-warm-root"
      data-warm-up={over ? 'done' : 'warming'}
    >
      {fontsReady && !over && (
        <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
          <WarmUp page="stream" canvas={CANVAS} scaling="fit" ticker={false} onDone={done} />
        </PlacedInParent>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const sendError = (report: Parameters<typeof window.drashti.app.renderError>[0]) =>
  window.drashti.app.renderError(report);
createRoot(root, {
  onUncaughtError: reportRenderError('stream’s warm-up page', 'uncaught', sendError),
  onCaughtError: reportRenderError('stream’s warm-up page', 'caught', sendError),
}).render(
  <StrictMode>
    <WarmOnly />
  </StrictMode>,
);
