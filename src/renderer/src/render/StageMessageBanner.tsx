import type { CSSProperties } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import {
  STAGE_MESSAGE_PX,
  STAGE_SIZE_FACTOR,
  type StageCall,
  stageFlashOn,
} from '../../../shared/stage-message';
import { fontFamilyFor } from './fonts';
import { textLang } from './lang';
import { useNow } from './useNow';

/*
 * The stage message (Session 55, Part 15, shared/stage-message.ts) on a stage screen: its look wherever it shows (the
 * Standard stage screen's own place, a layout's message box) and, over a layout with no message box or over the
 * audience picture with Stage off, a banner across the top. Amber with black words, as it always was; its own size;
 * and, when asked, a slow flash as it comes up (white and amber in turn, once a second, the same moment on every stage
 * screen, by the engine's clock).
 */

/** The message's colours at `now`: amber, or white while it flashes. */
export function stageMessageColors(call: StageCall | null | undefined, now: number): CSSProperties {
  return { background: stageFlashOn(call, now) ? '#ffffff' : '#f5a524', color: '#000000' };
}

/** What a stage screen's message says of its look, for tests and a screen reader's nothing (it is a picture). */
export const stageMessageData = (call: StageCall | null | undefined) => ({
  'data-size': call?.size ?? 'standard',
  'data-flash': call?.flash === true ? 'true' : undefined,
});

/** The message's size on a stage screen 1080 high: the standard 64 px, or its own. */
export const stageMessagePx = (call: StageCall | null | undefined): number =>
  Math.round(STAGE_MESSAGE_PX * STAGE_SIZE_FACTOR[call?.size ?? 'standard'] * 10) / 10;

/** The banner across the top of a stage screen of this canvas, while a message is up. */
export function StageMessageBanner({ state, canvas }: { state: EngineState; canvas: Size }) {
  const now = useNow(250);
  const text = state.stageMessage;
  if (text === null) return null;
  const k = canvas.height / 1080;
  const size = stageMessagePx(state.stageCall) * k;
  return (
    <div
      data-testid="stage-message-banner"
      lang={textLang(text)}
      {...stageMessageData(state.stageCall)}
      style={{
        position: 'absolute',
        left: 48 * k,
        right: 48 * k,
        top: 48 * k,
        ...stageMessageColors(state.stageCall, now),
        fontFamily: fontFamilyFor(null, null),
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.2,
        padding: `${String(16 * k)}px ${String(32 * k)}px`,
        borderRadius: 16 * k,
        overflowWrap: 'anywhere',
      }}
    >
      {text}
    </div>
  );
}
