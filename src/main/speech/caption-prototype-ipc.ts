import type { IpcMainInvokeEvent } from 'electron';
import type { CaptionCorrection, CaptionReview } from '../../shared/caption-coordinator';
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
export function registerCaptionPrototypeIpc(_deps: {
  fromOperator(event: IpcMainInvokeEvent): boolean;
  captions: CaptionPrototypeControl;
}): void {
  handle(IPC.captions.prototypeView, () => null);
  handle(IPC.captions.setPrototypeOn, () => null);
  handle(IPC.captions.advancePrototype, () => null);
  handle(IPC.captions.restartPrototype, () => null);
  handle(IPC.captions.correctPrototype, () => false);
  handle(IPC.captions.dismissPrototype, () => false);
}
