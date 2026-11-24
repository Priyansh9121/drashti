/** Red first (alpha.22, Combine videos…): not built yet. */
export class CombineVideos {
  constructor(_deps: unknown) {}
  start(_raw: unknown): { ok: false; message: string } {
    return { ok: false, message: 'Not built yet.' };
  }
  list(): never[] {
    return [];
  }
  stop(_id: string): boolean {
    return false;
  }
  close(): void {}
}
