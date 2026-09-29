import type { CSSProperties } from 'react';
import type { MediaFit } from '../../../shared/engine/state';
import { mediaUrl } from '../../../shared/media';
import { OBJECT_FIT } from './media-style';
import { VideoStill } from './SlideView';

/** An image, or a video's still frame, filling its box (for thumbnails and previews; never plays). */
export function MediaStill({
  mediaId,
  media,
  fit = 'fit',
}: {
  mediaId: string;
  media: 'image' | 'video';
  fit?: MediaFit;
}) {
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: OBJECT_FIT[fit],
  };
  return media === 'image' ? (
    <img src={mediaUrl(mediaId)} alt="" draggable={false} style={style} />
  ) : (
    <VideoStill mediaId={mediaId} style={style} />
  );
}
