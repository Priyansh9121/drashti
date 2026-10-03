import { create } from 'zustand';
import type { NetworkResult, NetworkStatus } from '../../../shared/network';

/* The local network as the operator window sees it: its state, and whether its panel is open. */

interface NetworkView {
  status: NetworkStatus | null;
  open: boolean;
  error: string | null;
}

export const useNetwork = create<NetworkView>(() => ({ status: null, open: false, error: null }));

let connected = false;

export function connectNetwork(): void {
  if (connected) return;
  connected = true;
  window.drashti.network.onChanged((status) => {
    useNetwork.setState({ status });
  });
  void window.drashti.network.status().then((status) => {
    useNetwork.setState({ status });
  });
}

/** Run a change; a refusal is shown in the panel. */
export async function networkAction(run: () => Promise<NetworkResult>): Promise<NetworkResult> {
  const result = await run();
  useNetwork.setState(result.ok ? { status: result.status, error: null } : { error: result.message });
  return result;
}

export function openNetwork(): void {
  useNetwork.setState({ open: true, error: null });
}

export function closeNetwork(): void {
  useNetwork.setState({ open: false, error: null });
}
