import { PICTURE_WIDTHS } from '../../../../shared/device-pictures';
import { savedPictureName } from '../../../../shared/media';
import type { PictureLook, PixelSize } from '../../../../shared/picture-look';
import { editLayout, hasEdit, shownSize } from '../../../../shared/picture-look';
import { current } from '../device';
import type { NativeSlideSave } from './viewer-store';

/*
 * Save picture… on a phone or tablet (Session 55, Part 5): the picture looked at (a picture, or a deck's slide)
 * full size, as Drashti has it up to its largest step (7680 wide), turned, flipped and cropped as the screens show
 * it where the phone knows its look (a picture coming up or on the screens), handed to the phone's Share sheet. A
 * page over plain http has no Share sheet in a phone's browser: the picture is then downloaded instead, which the
 * phone opens with its own Share.
 */

const LARGEST = PICTURE_WIDTHS[PICTURE_WIDTHS.length - 1] ?? 7680;

/** The picture drawn as it shows (turned, flipped, cropped), at its own pixels; or made a PNG. */
async function drawn(blob: Blob, look: PictureLook | null, jpeg: boolean): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size: PixelSize = { width: bitmap.width, height: bitmap.height };
    const out = look ? shownSize(look, size) : size;
    const w = Math.max(1, Math.round(out.width));
    const h = Math.max(1, Math.round(out.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (look) {
      // As the screens place it: the part kept filling the canvas, the picture turned and flipped about its centre.
      const l = editLayout(look, size, { width: w, height: h }, 'fill');
      const pw = (l.picture.width / 100) * w;
      const ph = (l.picture.height / 100) * h;
      ctx.translate((l.picture.left / 100) * w + pw / 2, (l.picture.top / 100) * h + ph / 2);
      ctx.scale(look.flipX === true ? -1 : 1, look.flipY === true ? -1 : 1);
      ctx.rotate(((look.turn ?? 0) * Math.PI) / 180);
      ctx.drawImage(bitmap, -pw / 2, -ph / 2, pw, ph);
    } else ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, jpeg ? 'image/jpeg' : 'image/png', 0.92);
    });
  } finally {
    bitmap.close();
  }
}

/** Save a picture from this device: null when it was handed over, else what went wrong, in words. */
export async function savePictureHere(
  mediaId: string,
  name: string,
  look: PictureLook | null,
): Promise<string | null> {
  const token = current()?.token;
  let blob: Blob;
  try {
    const r = await fetch(`/api/v1/media/${encodeURIComponent(mediaId)}/picture?width=${String(LARGEST)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return 'Drashti could not send this picture now: try again in a moment.';
    blob = await r.blob();
  } catch {
    return 'Drashti could not be reached: check this device’s Wi-Fi, then try again.';
  }
  const jpeg = blob.type === 'image/jpeg';
  const edit = look && hasEdit(look) ? look : null;
  let out: Blob = blob;
  // Turned or cropped, or not a JPEG or a PNG (a WebP, a GIF): drawn here, as a JPEG for a photo, else a PNG.
  if (edit || (!jpeg && blob.type !== 'image/png')) {
    try {
      out = (await drawn(blob, edit, jpeg)) ?? blob;
    } catch {
      return 'This device could not draw the picture: save it on Drashti’s computer instead.';
    }
  }
  return handOverPicture(out, name);
}

/** Save the whole native deck slide as its selected click ends. */
export async function saveNativeSlideHere(
  slide: NativeSlideSave,
  name: string,
  looks: Record<string, PictureLook>,
): Promise<string | null> {
  const token = current()?.token;
  const query = new URLSearchParams({ format: 'png', slide: slide.slideId, click: String(slide.click) });
  try {
    const response = await fetch(
      `/api/v1/presentations/${encodeURIComponent(slide.presentationId)}?${query.toString()}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (response.ok && response.headers.get('Content-Type') === 'image/png')
      return await handOverPicture(await response.blob(), name);
    const reply: unknown = await response.json();
    if (reply && typeof reply === 'object') {
      if (response.ok && 'mediaId' in reply && typeof reply.mediaId === 'string') {
        return (
          (await savePictureHere(reply.mediaId, name, looks[reply.mediaId] ?? null)) ??
          ('message' in reply && typeof reply.message === 'string'
            ? reply.message
            : 'This is the slide as it starts. Try again when the screens are still to save this click.')
        );
      }
      if ('message' in reply && typeof reply.message === 'string') return reply.message;
    }
  } catch {
    return 'Drashti could not be reached: check this device’s Wi-Fi, then try again.';
  }
  return 'Drashti could not send this picture now: try again in a moment.';
}

async function handOverPicture(out: Blob, name: string): Promise<string | null> {
  const file = new File([out], savedPictureName(name, out.type === 'image/jpeg'), { type: out.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return null;
    } catch (error) {
      // Closed without choosing: nothing went wrong.
      if (error instanceof DOMException && error.name === 'AbortError') return null;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
  return null;
}
