import { useEngine } from '../engine/engine-store';
import { readPersisted } from '../ui/persist';
import {
  STAGE_BOX_COLOR,
  STAGE_COLOR_PRESETS,
  STAGE_TEXT_COLOR,
  stageColorSchema,
} from '../../../shared/stage-message';

/*
 * The stage message's colours chosen on this computer (the owner, 24 Nov 2026), remembered in the operator window's
 * own storage. Since alpha.22 the show is told them too, as they change and as the window starts (in either mode), so
 * a message sent without colours of its own (a phone's, its Shown before, OSC's) shows them on the stage.
 */

/** As chosen: a preset's id, or 'own', and the two colours. */
export interface StageColours {
  preset: string;
  box: string;
  text: string;
}

export const STAGE_COLOURS_KEY = 'stage.colours';
export const AS_ALWAYS: StageColours = { preset: 'amber', box: STAGE_BOX_COLOR, text: STAGE_TEXT_COLOR };
export const OWN = 'own';

export const isStageColours = (v: unknown): v is StageColours => {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<Record<keyof StageColours, unknown>>;
  return (
    (c.preset === OWN || STAGE_COLOR_PRESETS.some((p) => p.id === c.preset)) &&
    stageColorSchema.safeParse(c.box).success &&
    stageColorSchema.safeParse(c.text).success
  );
};

/** The colours a message or the show is sent: none for amber and black, as before. */
export const coloursSent = (c: StageColours): { boxColor?: string; textColor?: string } =>
  c.box !== STAGE_BOX_COLOR || c.text !== STAGE_TEXT_COLOR ? { boxColor: c.box, textColor: c.text } : {};

/** Tell the show this computer's colours: a setting, never a notice in the window nor a step of the show. */
export function tellStageColours(c: StageColours): void {
  void window.drashti.engine.dispatch({ type: 'setStageColours', ...coloursSent(c) }).catch(() => undefined);
}

let connected = false;

/**
 * As the window starts, in either mode: the colours remembered on this computer, once it has the show (its copy is
 * what a window's command is checked against), and again for a new run of the show, which starts with none. Once
 * per page.
 */
export function connectStageColours(): void {
  if (connected) return;
  connected = true;
  let told: string | undefined;
  const tell = (session: string | undefined) => {
    if (session === undefined || session === told) return;
    told = session;
    tellStageColours(readPersisted(STAGE_COLOURS_KEY, AS_ALWAYS, isStageColours));
  };
  tell(useEngine.getState().session);
  useEngine.subscribe((s) => {
    tell(s.session);
  });
}
