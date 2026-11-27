/** Up's or Down's tooltip on the chosen playlist item, with its key as this computer writes it (filled in next). */
export function moveTitle(step: -1 | 1, platform: string): string {
  void platform;
  return step < 0 ? 'Up a place (Alt+↑)' : 'Down a place (Alt+↓)';
}
