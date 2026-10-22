import { create } from 'zustand';
import {
  type CameraAccess,
  inputNamed,
  type VideoInput,
  type VideoInputFields,
  type VideoInputStatus,
} from '../../../shared/video-inputs';
import { dispatch } from '../operator/actions';

/*
 * Video inputs in the operator window (Session 50): this computer's named inputs (Media's Video inputs), Add a
 * Video Input… (or changing one), whether Drashti may use the cameras, and how the input on the screens stands
 * (the notice when it stops), in either mode.
 */

interface VideoInputsUi {
  inputs: VideoInput[];
  /** The dialog: adding one (editing null) or changing one; null while shut. */
  dialog: { editing: VideoInput | null } | null;
  /** May Drashti use the cameras: null until the main process has said. */
  access: CameraAccess | null;
  status: VideoInputStatus;
}

export const useVideoInputs = create<VideoInputsUi>(() => ({
  inputs: [],
  dialog: null,
  access: null,
  status: { stopped: null, access: 'unknown' },
}));

let connected = false;

/** Follow the list and how the input on the screens stands (once, as the operator window opens). */
export function connectVideoInputs(): void {
  if (connected) return;
  connected = true;
  const inputs = window.drashti.videoInputs;
  inputs.onChanged((view) => {
    useVideoInputs.setState({ inputs: view.inputs });
  });
  inputs.onStatus((status) => {
    useVideoInputs.setState({ status, access: status.access });
  });
  void inputs.list().then(
    (view) => {
      useVideoInputs.setState({ inputs: view.inputs });
    },
    () => undefined,
  );
  void inputs.status().then(
    (status) => {
      useVideoInputs.setState({ status, access: status.access });
    },
    () => undefined,
  );
}

/** Ask the main process again whether Drashti may use the cameras (as the dialog opens, and Look again). */
export async function readAccess(): Promise<void> {
  const access = await window.drashti.videoInputs.access().catch((): CameraAccess => 'unknown');
  useVideoInputs.setState({ access });
}

/** A Mac: macOS asks for the camera, now that Drashti has said why. */
export async function askAccess(): Promise<void> {
  const access = await window.drashti.videoInputs.askAccess().catch((): CameraAccess => 'unknown');
  useVideoInputs.setState({ access });
}

export function openAddInput(): void {
  useVideoInputs.setState({ dialog: { editing: null } });
}

export function openChangeInput(input: VideoInput): void {
  useVideoInputs.setState({ dialog: { editing: input } });
}

export function closeInputDialog(): void {
  useVideoInputs.setState({ dialog: null });
}

/**
 * This computer's video input of a name (Session 51: the one a playlist item or a slide's background cue names), or
 * null: it follows Media's list as inputs are added, renamed or removed.
 */
export function useInputNamed(name: string | null): VideoInput | null {
  return useVideoInputs((s) => (name === null ? null : inputNamed(s.inputs, name)));
}

/** One click: the input on the screens, as the live background with the slide staying over it. */
export function showInput(inputId: string): Promise<void> {
  return dispatch({ type: 'showInput', inputId });
}

/** Add one, or change it: null once done, or what went wrong. */
export async function saveInput(
  editing: VideoInput | null,
  fields: VideoInputFields,
): Promise<string | null> {
  const inputs = window.drashti.videoInputs;
  const result = await (editing ? inputs.update(editing.id, fields) : inputs.add(fields)).catch(() => null);
  if (!result) return 'Drashti could not keep it. Try again in a moment.';
  if (!result.ok) return result.message;
  useVideoInputs.setState({ inputs: result.view.inputs });
  return null;
}

/** Take one out of Media: null once done, or what went wrong. */
export async function removeInput(id: string): Promise<string | null> {
  const result = await window.drashti.videoInputs.remove(id).catch(() => null);
  if (!result) return 'Drashti could not remove it. Try again in a moment.';
  if (!result.ok) return result.message;
  useVideoInputs.setState({ inputs: result.view.inputs });
  return null;
}
