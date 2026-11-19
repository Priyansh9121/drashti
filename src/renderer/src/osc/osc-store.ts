import { create } from 'zustand';
import type { OscSettings, OscStatus } from '../../../shared/osc';

export const useOsc = create<{ status: OscStatus | null; open: boolean; error: string | null }>(() => ({
  status: null,
  open: false,
  error: null,
}));
let connected = false;
export function connectOsc(): void {
  if (connected) return;
  connected = true;
  window.drashti.osc.onChanged((status) => {
    useOsc.setState({ status });
  });
  void window.drashti.osc.status().then(
    (status) => {
      useOsc.setState({ status });
    },
    () => {
      useOsc.setState({ error: 'OSC settings could not be read. Close this panel and try again.' });
    },
  );
}
export function openOsc(): void {
  useOsc.setState({ open: true, error: null });
  void window.drashti.osc.status().then(
    (status) => {
      useOsc.setState({ status });
    },
    () => {
      useOsc.setState({ error: 'OSC settings could not be read. Close this panel and try again.' });
    },
  );
}
export function closeOsc(): void {
  useOsc.setState({ open: false, error: null });
}
export async function saveOsc(settings: OscSettings): Promise<void> {
  try {
    const result = await window.drashti.osc.configure(settings);
    useOsc.setState(result.ok ? { status: result.status, error: null } : { error: result.message });
  } catch {
    useOsc.setState({ error: 'OSC settings could not be saved. Try again in Pro Mode.' });
  }
}
