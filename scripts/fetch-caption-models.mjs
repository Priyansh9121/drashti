// Red: CAP-CI-1 (a), the caption models for CI's measuring only. Not built yet: every call fails.
export const CAPTION_MODELS = Object.freeze({});
export const DEFAULT_CACHE = '';
export function hostAllowed() {
  return true;
}
export function refuseInsideCheckout() {}
export async function fetchCaptionModel() {
  throw new Error('not built yet');
}
