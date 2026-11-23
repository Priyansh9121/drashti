/** Font fitting is enabled only for the phase D clause band. */
export function fittedCaptionFont(base: number, available: number, measured: number): number {
  return available > 0 && measured > available ? Math.floor((base * available) / measured) : base;
}

/** Reset a reused band before either the legacy or fitted path measures it. */
export function prepareCaptionFont(style: { fontSize: string }, base: number, fit: boolean): boolean {
  // A band reused after a fitted clause still carries the fitted size: back to the configured one first.
  style.fontSize = `${String(base)}px`;
  return fit;
}
