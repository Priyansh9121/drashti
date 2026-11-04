import { create } from 'zustand';
import { DEFAULT_SPEECH_HELPERS, type SpeechHelperView } from '../../../shared/ai-speech';
import { useMode } from '../operator/mode-store';
const empty = (): SpeechHelperView => ({
  settings: { ...DEFAULT_SPEECH_HELPERS },
  listening: 'off',
  books: null,
  verse: null,
  problem: null,
});
export const useSpeechHelpers = create<SpeechHelperView & { saving: boolean }>(() => ({
  ...empty(),
  saving: false,
}));
let connected = false;
let generation = 0;
export function connectSpeechHelpers(): void {
  if (connected) return;
  connected = true;
  const refresh = () => {
    const current = ++generation;
    if (useMode.getState().mode !== 'pro') {
      useSpeechHelpers.setState(empty());
      return;
    }
    void window.drashti.aiSpeech.get().then((result) => {
      if (current === generation && result.ok) useSpeechHelpers.setState(result.value);
    });
  };
  window.drashti.aiSpeech.onChanged((value) => {
    if (useMode.getState().mode === 'pro') useSpeechHelpers.setState(value);
  });
  useMode.subscribe(refresh);
  refresh();
}
export async function setSpeechHelper(key: 'books' | 'verse', on: boolean): Promise<void> {
  useSpeechHelpers.setState({ saving: true, problem: null });
  try {
    const result = await window.drashti.aiSpeech.set({ ...useSpeechHelpers.getState().settings, [key]: on });
    useSpeechHelpers.setState(result.ok ? result.value : { problem: result.message });
  } catch {
    useSpeechHelpers.setState({ problem: 'The choice could not be saved. Try again.' });
  } finally {
    useSpeechHelpers.setState({ saving: false });
  }
}
