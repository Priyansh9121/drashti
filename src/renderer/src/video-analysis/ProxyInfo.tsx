import { useEffect, useState } from 'react';
import type { VideoProxyResult } from '../../../shared/video-copies';
import { Button } from '../ui/Button';

export function ProxyInfo({ mediaId, controls = true }: { mediaId: string; controls?: boolean }) {
  const [reading, setReading] = useState<{ id: string; result: VideoProxyResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let wanted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (retry: boolean) => {
      try {
        const result = await window.drashti.media.proxyStatus(mediaId, retry);
        if (!wanted) return;
        setReading({ id: mediaId, result });
        if (result.ok && ['checking', 'waiting', 'preparing'].includes(result.proxy.state))
          timer = setTimeout(() => {
            void load(false);
          }, 1000);
      } catch {
        if (wanted)
          setReading({
            id: mediaId,
            result: {
              ok: false,
              message: 'The lighter copy’s status could not be read. Close this window and try again.',
            },
          });
      }
    };
    void load(attempt > 0);
    return () => {
      wanted = false;
      clearTimeout(timer);
    };
  }, [mediaId, attempt]);
  const result = reading?.id === mediaId ? reading.result : null;
  const proxy = result?.ok ? result.proxy : null;
  const pending = proxy && ['checking', 'waiting', 'preparing'].includes(proxy.state);
  const words =
    result && !result.ok
      ? result.message
      : proxy?.state === 'ready'
        ? `Next showing uses the lighter ${String(proxy.width)} × ${String(proxy.height)} playing copy. The original is kept.`
        : proxy?.state === 'not-needed'
          ? 'Next showing uses the original video; a lighter copy is not needed.'
          : (proxy?.message ?? proxy?.note ?? 'The lighter copy is checked while idle.');
  return (
    <section
      aria-label="Lighter playing copy"
      className="space-y-2 rounded border border-line p-3"
      data-testid="video-proxy-info"
    >
      <p className="text-sm" role="status">
        {words}
      </p>
      {controls && (
        <div className="flex gap-2">
          {pending && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void window.drashti.media
                  .stopProxy(mediaId)
                  .then(() => window.drashti.media.proxyStatus(mediaId))
                  .then((result) => setReading({ id: mediaId, result }));
              }}
            >
              Stop lighter copy
            </Button>
          )}
          {proxy && ['failed', 'stopped'].includes(proxy.state) && (
            <Button type="button" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Retry lighter copy
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
