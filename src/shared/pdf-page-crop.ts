import type { RenderSlide } from './model';
import type { Size } from './scaling';
import type { CropRect } from './picture-look';
/** Resolve the page viewport once before fitting it on any output. Elements stay in original coordinates. */
export function cropRenderedPage(slide: RenderSlide, crop?: CropRect, paper?: Size): RenderSlide {
  if (!crop) return slide;
  const scale = paper ? Math.min(slide.width / paper.width, slide.height / paper.height) : 1;
  const width = paper ? paper.width * scale : slide.width;
  const height = paper ? paper.height * scale : slide.height;
  return {
    ...slide,
    width: width * crop.w,
    height: height * crop.h,
    pageCrop: {
      x: (slide.width - width) / 2 + width * crop.x,
      y: (slide.height - height) / 2 + height * crop.y,
      width: slide.width,
      height: slide.height,
    },
    fullSlide: true,
  };
}
