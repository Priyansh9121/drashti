import { useEffect, useState } from 'react';
import type { VideoAnalysisResult } from '../../../shared/video-analysis';

/** Only an open editor or the one hovered/focused Media row asks for analysis. */
export function useAnalysis(mediaId: string, audioStream: number | null = 0, active = true) {
  const key = `${mediaId}:${String(audioStream)}`;
  const [reading, setReading] = useState<{ key: string; result: VideoAnalysisResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let wanted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (retry: boolean) => {
      try {
        const result = await window.drashti.media.videoAnalysis(mediaId, audioStream, retry);
        if (!wanted) return;
        setReading({ key, result });
        if (result.ok && (result.analysis.state === 'waiting' || result.analysis.state === 'preparing'))
          timer = setTimeout(() => {
            void load(false);
          }, 1000);
      } catch {
        if (wanted)
          setReading({
            key,
            result: {
              ok: false,
              message: 'The video preview could not be read. Open the video again, then try again.',
            },
          });
      }
    };
    void load(attempt > 0);
    return () => {
      wanted = false;
      clearTimeout(timer);
    };
  }, [mediaId, audioStream, key, active, attempt]);
  return {
    result: reading?.key === key ? reading.result : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
