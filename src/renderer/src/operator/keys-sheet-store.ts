import { create } from 'zustand';

/* Operator actions are also used by stores without a mounted view, so this state imports no dialog or DOM code. */
export const useKeysSheet = create<{ open: boolean }>(() => ({ open: false }));

export function showKeysSheet(): void {
  useKeysSheet.setState({ open: true });
}
