import type { RenderSlide } from './model';
import type { CropRect } from './picture-look';
export function cropRenderedPage(_slide: RenderSlide, _crop?: CropRect): RenderSlide {
  throw new Error('PDF crop rendering is not implemented yet.');
}
