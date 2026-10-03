import { create } from 'zustand';
import type {
  CameraState,
  DeviceChoice,
  ProgramContext,
  ProgramInputs,
  SoundState,
} from '../../../shared/stream';

/** The stream's page: what it was told, and what it found. */
interface ProgramStore {
  context: ProgramContext | null;
  cameras: DeviceChoice[];
  microphones: DeviceChoice[];
  camera: CameraState;
  sound: SoundState;
  message: string | null;
  /** The camera's picture, while it is on. */
  cameraStream: MediaStream | null;
}

export const useProgram = create<ProgramStore>(() => ({
  context: null,
  cameras: [],
  microphones: [],
  camera: 'none',
  sound: 'none',
  message: null,
  cameraStream: null,
}));

let reported = '';

/** Tell the main process what the page sees, when it changes. */
export function reportInputs(): void {
  const s = useProgram.getState();
  const inputs: ProgramInputs = {
    cameras: s.cameras,
    microphones: s.microphones,
    camera: s.camera,
    sound: s.sound,
    message: s.message,
  };
  const key = JSON.stringify(inputs);
  if (key === reported) return;
  reported = key;
  void window.drashti.stream.page.reportInputs(inputs);
}
