/*
 * The copy of a picture chosen for the middle of a QR code (Q60-28): drawn here, once, at most 1024 pixels a side, its
 * shape kept, and given to the main process as a PNG to keep (main/library/qr-service.ts), so the main process never
 * decodes a chosen file itself. Chromium reads the picture as the screens do (a JPEG turned as its camera said).
 */

/** The longer side of the copy, at most. */
const SIDE = 1024;

/** A picture's bytes (PNG or JPEG) as a PNG at most 1024 pixels a side, or null when it cannot be read. */
export async function logoCopy(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    try {
      const scale = Math.min(1, SIDE / Math.max(1, bitmap.width), SIDE / Math.max(1, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
