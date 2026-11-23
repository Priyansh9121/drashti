/** Font fitting is enabled only for the phase D clause band. */
export function fittedCaptionFont(base: number, available: number, measured: number): number {
  return available > 0 && measured > available ? Math.floor(base * available / measured) : base;
}
