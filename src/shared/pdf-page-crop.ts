import type { RenderSlide } from './model';
import type { CropRect } from './picture-look';
/** Resolve the page viewport once before fitting it on any output. Elements stay in original coordinates. */
export function cropRenderedPage(slide: RenderSlide, crop?: CropRect): RenderSlide {
  if (!crop) return slide;
  return {
    ...slide,
    width: slide.width * crop.w,
    height: slide.height * crop.h,
    pageCrop: { x: slide.width * crop.x, y: slide.height * crop.y, width: slide.width, height: slide.height },
    fullSlide: true,
  };
}
