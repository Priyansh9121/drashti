import { create } from 'zustand';
import type { AudioDevice, AudioOutputStatus } from '../../../shared/audio';

/** Where sound plays, as the main process last said. */
export const useSound = create<{ status: AudioOutputStatus | null }>(() => ({ status: null }));

let connected = false;

export function connectSound(): void {
  if (connected) return;
  connected = true;
  window.drashti.audio.onStatus((status) => {
    useSound.setState({ status });
  });
  void window.drashti.audio.getOutput().then((status) => {
    useSound.setState({ status });
  });
}

export async function chooseOutput(device: AudioDevice | null): Promise<void> {
  const status = await window.drashti.audio.setOutput(device);
  useSound.setState({ status });
}
