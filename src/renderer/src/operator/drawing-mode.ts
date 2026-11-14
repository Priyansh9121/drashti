import { create } from 'zustand';
import { setDrawsWithoutChip } from '../render/chipless';

/** The operator window’s LIVE and Screens previews share the drawing mode Main reports. */
export const useDrawingMode = create<{ chipless: boolean }>(() => ({ chipless: false }));

let listening = false;

/** Listen before asking so a late GPU update also reaches pictures already drawing. */
export function connectDrawingMode(): void {
  if (listening) return;
  listening = true;
  const chipless = () => {
    setDrawsWithoutChip(true);
    useDrawingMode.setState({ chipless: true });
  };
  const off = window.drashti.app.onNoGpu(chipless);
  void window.drashti.app.noGpu().then(
    (on) => {
      if (on) chipless();
    },
    () => {
      listening = false;
      off();
    },
  );
}
