/** Red first (alpha.22, Export…): not built yet. */
export function exportOffer(_downloads: string, _name: string): string {
  throw new Error('Not built yet.');
}
export function exportCopy(_options: unknown): Promise<{ ok: false; message: string }> {
  return Promise.resolve({ ok: false, message: 'Not built yet.' });
}
