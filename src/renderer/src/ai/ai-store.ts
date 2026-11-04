import { create } from 'zustand';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../../../shared/ai';
import { useMode } from '../operator/mode-store';
import { setSearch } from '../library/library-store';
interface View {
  settings: AiSettings;
  open: boolean;
  problem: string | null;
  saving: boolean;
}
export const useAi = create<View>(() => ({
  settings: { ...DEFAULT_AI_SETTINGS },
  open: false,
  problem: null,
  saving: false,
}));
let connected = false;
let generation = 0;
export function connectAi(): void {
  if (connected) return;
  connected = true;
  const refresh = () => {
    const current = ++generation;
    if (useMode.getState().mode !== 'pro') {
      useAi.setState({ settings: { ...DEFAULT_AI_SETTINGS }, open: false });
      return;
    }
    void window.drashti.ai.get().then((result) => {
      if (current === generation && result.ok) useAi.setState({ settings: result.value });
    });
  };
  window.drashti.ai.onOpen(() => {
    if (useMode.getState().mode === 'pro') useAi.setState({ open: true, problem: null });
  });
  window.drashti.ai.onChanged((settings) => {
    useAi.setState({ settings });
    setSearch('');
  });
  useMode.subscribe(refresh);
  refresh();
}
export async function setAi(settings: AiSettings): Promise<void> {
  useAi.setState({ saving: true, problem: null });
  try {
    const result = await window.drashti.ai.set(settings);
    useAi.setState(result.ok ? { settings: result.value } : { problem: result.message });
  } catch {
    useAi.setState({ problem: 'The choice could not be saved. Try again.' });
  } finally {
    useAi.setState({ saving: false });
  }
}
