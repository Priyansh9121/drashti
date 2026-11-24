import { type CSSProperties, useRef } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { Size } from '../../../shared/scaling';
import {
  STAGE_MESSAGE_PX,
  STAGE_SIZE_FACTOR,
  type StageCall,
  stageMessageLook,
} from '../../../shared/stage-message';
import { fontFamilyFor } from './fonts';
import { textLang } from './lang';
import { useNow } from './useNow';
import { atMessageFit, messageAlign, runsPast, useStageMessageFit } from './stage-message-fit';

/*
 * The stage message (Session 55, Part 15, shared/stage-message.ts) on a stage screen: its look wherever it shows (the
 * Standard stage screen's own place, a layout's message box) and, over a layout with no message box or over the
 * audience picture with Stage off, a banner across the top. Amber with black words, as it always was, or the colours
 * chosen for it; its own size; and, when asked, a slow flash as it comes up (white and its box's colour in turn, amber
 * for a white box, once a second, the same moment on every stage screen, by the engine's clock). A message too long
 * for its place wraps, is centred and is drawn only as much smaller as it must be to fit (render/stage-message-fit.ts):
 * the banner within the screen's margins, the Standard stage screen's within the screen less its own.
 */

/**
 * The message's colours at `now`: its own (chosen in the Stage screen panel, 24 Nov 2026), or amber with black words
 * (`words`: a layout box's own words' colour), and its flash colour while it flashes (shared/stage-message.ts).
 */
export function stageMessageColors(
  call: StageCall | null | undefined,
  now: number,
  words?: string,
): CSSProperties {
  return stageMessageLook(call, now, words);
}

/** What a stage screen's message says of its look, for tests and a screen reader's nothing (it is a picture). */
export const stageMessageData = (call: StageCall | null | undefined) => ({
  'data-size': call?.size ?? 'standard',
  'data-flash': call?.flash === true ? 'true' : undefined,
});

/** The message's size on a stage screen 1080 high: the standard 64 px, or its own. */
export const stageMessagePx = (call: StageCall | null | undefined): number =>
  Math.round(STAGE_MESSAGE_PX * STAGE_SIZE_FACTOR[call?.size ?? 'standard'] * 10) / 10;

/** The stage message's own place on the Standard stage screen (StageView), above NOW and NEXT: within the screen. */
export function StageMessageOnStage({ state, now }: { state: EngineState; now: number }) {
  const place = useRef<HTMLDivElement>(null);
  const text = state.stageMessage;
  const size = stageMessagePx(state.stageCall);
  useStageMessageFit(place, runsPast, `${text ?? ''}|${String(size)}`);
  if (text === null) return null;
  return (
    <div
      ref={place}
      data-testid="stage-message"
      lang={textLang(text)}
      // Its own size and flash (Session 55, Part 15).
      {...stageMessageData(state.stageCall)}
      style={{
        ...stageMessageColors(state.stageCall, now),
        fontSize: atMessageFit(`${String(size)}px`),
        fontWeight: 700,
        lineHeight: 1.2,
        padding: '16px 32px',
        borderRadius: 16,
        overflowWrap: 'anywhere',
        textAlign: messageAlign('start') as CSSProperties['textAlign'],
        // As tall as its words, up to all the stage screen holds inside its margins (NOW and NEXT give way first).
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {text}
    </div>
  );
}

/** The banner across the top of a stage screen of this canvas, while a message is up. */
export function StageMessageBanner({ state, canvas }: { state: EngineState; canvas: Size }) {
  const now = useNow(250);
  const place = useRef<HTMLDivElement>(null);
  const text = state.stageMessage;
  const k = canvas.height / 1080;
  const size = stageMessagePx(state.stageCall) * k;
  useStageMessageFit(place, runsPast, `${text ?? ''}|${String(size)}|${String(canvas.width)}`);
  if (text === null) return null;
  return (
    <div
      ref={place}
      data-testid="stage-message-banner"
      lang={textLang(text)}
      {...stageMessageData(state.stageCall)}
      style={{
        position: 'absolute',
        left: 48 * k,
        right: 48 * k,
        top: 48 * k,
        // As tall as its words, up to the screen less its margins.
        maxHeight: canvas.height - 96 * k,
        boxSizing: 'border-box',
        overflow: 'hidden',
        ...stageMessageColors(state.stageCall, now),
        fontFamily: fontFamilyFor(null, null),
        fontSize: atMessageFit(`${String(size)}px`),
        fontWeight: 700,
        lineHeight: 1.2,
        padding: `${String(16 * k)}px ${String(32 * k)}px`,
        borderRadius: 16 * k,
        overflowWrap: 'anywhere',
        textAlign: messageAlign('start') as CSSProperties['textAlign'],
      }}
    >
      {text}
    </div>
  );
}
