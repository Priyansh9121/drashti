/** Font fitting is enabled only for the phase D clause band. */
export function fittedCaptionFont(base: number, available: number, measured: number): number {
  return available > 0 && measured > available ? Math.floor((base * available) / measured) : base;
}

/** Reset a reused band before either the legacy or fitted path measures it. */
export function prepareCaptionFont(_style: { fontSize: string }, _base: number, fit: boolean): boolean {
  return fit;
}
