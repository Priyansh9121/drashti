import { useEffect, useState } from 'react';
import { PreviewPicture } from '../../render/previews';
import { Music } from '../../ui/icons';

/*
 * A shared file shown on this device (Session 54, D3): every file at full quality, as D1 serves it. Pictures (a
 * media item's, a slide's and a deck's or PDF's pages) come through the pages' picture loader (render/previews.tsx,
 * web/previews.ts), which D1 makes fetch them at the width they are drawn, up to the original. A video or a sound
 * plays on the device from the address `playableUrl` gives.
 *
 * Until D1's requests are in this build, `playableUrl` has none to give: a video shows its picture, a sound its
 * name. The lead switches it to D1's link for a <video> (GET /api/v1/media/{id}/link, its `url`), and to a sound's
 * once D1 serves sounds' files (it serves pictures' and videos' only).
 */

/** Where this device plays a video's or sound's own file from, or null when it cannot. */
export function playableUrl(_mediaId: string, _kind: 'video' | 'audio'): Promise<string | null> {
  return Promise.resolve(null);
}

const FILL = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
} as const;

/** A picture filling its box, as large as fits. */
export function DevicePicture({ mediaId }: { mediaId: string }) {
  return (
    <div className="absolute inset-0" data-a11y-picture>
      <PreviewPicture mediaId={mediaId} style={FILL} />
    </div>
  );
}

/** A video or a sound, played here on the device with its own controls; its picture or its name until it can be. */
export function DevicePlayer({
  mediaId,
  kind,
  label,
}: {
  mediaId: string;
  kind: 'video' | 'audio';
  label: string;
}) {
  // The address found, for the file it was found for.
  const [found, setFound] = useState<{ mediaId: string; url: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    void playableUrl(mediaId, kind).then((url) => {
      if (live) setFound({ mediaId, url });
    });
    return () => {
      live = false;
    };
  }, [mediaId, kind]);
  const url = found?.mediaId === mediaId ? found.url : null;
  if (url && kind === 'video')
    return (
      // On this device only, with its own time bar; never on the screens.
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-contain"
        aria-label={label}
        data-testid="shared-video"
      />
    );
  if (url)
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full"
          aria-label={label}
          data-testid="shared-audio"
        />
      </div>
    );
  if (kind === 'video') return <DevicePicture mediaId={mediaId} />;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Music size={48} aria-hidden="true" className="text-muted" />
      <p className="text-base text-fg">{label}</p>
    </div>
  );
}
