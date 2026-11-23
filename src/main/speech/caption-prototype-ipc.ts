import type { IpcMainInvokeEvent } from 'electron';
import { captionCorrectionSchema, captionIdentitySchema, type CaptionCorrection, type CaptionReview } from '../../shared/caption-coordinator';
import { IPC } from '../../shared/ipc';
import { handle } from '../ipc/handle';

export interface CaptionPrototypeControl {
  prototypeView(): CaptionReview;
  setPrototypeOn(on: boolean): void;
  advancePrototype(): void;
  restartPrototype(): void;
  correctPrototype(correction: CaptionCorrection): boolean;
  dismissPrototype(identity: Omit<CaptionCorrection, 'text'>): boolean;
}
export function registerCaptionPrototypeIpc(deps: {
  fromOperator(event: IpcMainInvokeEvent): boolean;
  captions: CaptionPrototypeControl;
}): void {
  handle(IPC.captions.prototypeView, e => deps.fromOperator(e) ? deps.captions.prototypeView() : null);
  handle(IPC.captions.setPrototypeOn, (e, on) => {
    if (!deps.fromOperator(e) || typeof on !== 'boolean') return null;
    deps.captions.setPrototypeOn(on);
    return deps.captions.prototypeView();
  });
  handle(IPC.captions.advancePrototype, e => {
    if (!deps.fromOperator(e)) return null;
    deps.captions.advancePrototype();
    return deps.captions.prototypeView();
  });
  handle(IPC.captions.restartPrototype, e => {
    if (!deps.fromOperator(e)) return null;
    deps.captions.restartPrototype();
    return deps.captions.prototypeView();
  });
  handle(IPC.captions.correctPrototype, (e, raw) => {
    if (!deps.fromOperator(e)) return false;
    const parsed = captionCorrectionSchema.safeParse(raw);
    return parsed.success && deps.captions.correctPrototype(parsed.data);
  });
  handle(IPC.captions.dismissPrototype, (e, raw) => {
    if (!deps.fromOperator(e)) return false;
    const parsed = captionIdentitySchema.safeParse(raw);
    return parsed.success && deps.captions.dismissPrototype(parsed.data);
  });
}
