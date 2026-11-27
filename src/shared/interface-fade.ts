/** The safe interface pictures that can fade; a show control and an output never take part. */
export type InterfaceFade = 'look' | 'mode' | 'help';

/** Run a change; the red contract below will add scoped snapshots. */
export function fadeInterface(change: () => void, _kind: InterfaceFade, _allowed = true): void {
  change();
}

/** End an interface fade before the show changes. */
export function stopInterfaceFade(): void {}
