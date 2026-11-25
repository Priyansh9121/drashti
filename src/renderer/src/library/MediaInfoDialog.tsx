import { ProxyInfo } from '../video-analysis/ProxyInfo';
import { useEffect, useId, useMemo, useState } from 'react';
import type { DetailExtras, DetailSection, MediaDetailsResult } from '../../../shared/media-details';
import { detailSections, detailsText, detailsTitle } from '../../../shared/media-details';
import { revealLabel } from '../files/file-menu';
import { revealFile } from '../files/FileMenu';
import { useNotice } from '../operator/actions';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Check, Copy, FolderOpen } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { addMediaInfoToMenu, closeMediaInfo, useMediaInfo } from './media-info';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, his "Yes, all A" to Q60-39): what a video's or a sound's
 * file holds, as the bundled FFmpeg reads it in the main process, in a small window over the operator window: the file,
 * each picture and sound track, the captions and cover in it, and how Drashti plays it (shared/media-details.ts says
 * each in words). Copy gives the same words, for a message or a problem report. It only reads: nothing on the screens
 * or in the library changes. Its item is in the one right-click menu for every video and sound, Simple Mode's too.
 */

export function MediaInfoDialog({ platform, simple = false }: { platform: string; simple?: boolean }) {
  const media = useMediaInfo((s) => s.media);
  // In the one right-click menu, once for the window (Pro Mode's and Simple Mode's alike).
  useEffect(() => {
    addMediaInfoToMenu();
  }, []);
  if (!media) return null;
  return <InfoWindow key={media.id} media={media} platform={platform} simple={simple} />;
}

/** What the main process read, and the library's other notes: the file's points and markers, its Even loudness. */
interface Loaded {
  result: MediaDetailsResult;
  extras: DetailExtras;
}

function InfoWindow({
  media,
  platform,
  simple,
}: {
  media: { id: string; name: string };
  platform: string;
  simple: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      window.drashti.media.details(media.id),
      window.drashti.media.markers(media.id).catch(() => null),
      window.drashti.sound.file(media.id).catch(() => null),
      window.drashti.media.pageCopies().catch(() => null),
    ]).then(
      ([result, markers, sound, copies]) => {
        if (!live) return;
        setLoaded({
          result,
          extras: {
            points: markers
              ? { startMs: markers.startMs, endMs: markers.endMs, markers: markers.markers.length }
              : null,
            loudness: sound
              ? { even: sound.even, measured: sound.measured, lufs: sound.lufs, gainDb: sound.gainDb }
              : null,
            pageCopies: copies?.[media.id] ?? null,
          },
        });
      },
      () => {
        if (live)
          setLoaded({
            result: {
              ok: false,
              message: 'Drashti could not read this file’s information: close this window and try again.',
            },
            extras: {},
          });
      },
    );
    return () => {
      live = false;
    };
  }, [media.id]);
  const details = loaded?.result.ok ? loaded.result.details : null;
  const sections = useMemo(
    () => (details && loaded ? detailSections(details, loaded.extras) : []),
    [details, loaded],
  );
  const copy = () => {
    if (!details) return;
    // By the main process: Drashti refuses every page its own clipboard (windows/security.ts).
    const failed = () => {
      useNotice.setState({
        text: 'Drashti could not copy the information: choose its words and copy them by hand.',
      });
    };
    void window.drashti.media.copyDetails(detailsText(details, sections)).then((done) => {
      if (done) setCopied(true);
      else failed();
    }, failed);
  };
  return (
    <Dialog
      title={detailsTitle(details?.name ?? media.name)}
      onClose={closeMediaInfo}
      size="md"
      testId="media-info"
      bodyFocusable
      footer={
        <>
          {/* Simple Mode's menu never shows a file in the Finder or Explorer: nor does this window there. */}
          {!simple && (
            <Button icon={FolderOpen} onClick={() => void revealFile({ mediaId: media.id })}>
              {revealLabel(platform)}
            </Button>
          )}
          <Button icon={copied ? Check : Copy} disabled={!details} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      }
    >
      {!loaded ? (
        <Loading label="Reading the file…" />
      ) : !loaded.result.ok ? (
        <Notice tone="danger">{loaded.result.message}</Notice>
      ) : (
        <div className="space-y-4">
          {details?.problem && (
            <Notice tone="warning" compact>
              {details.problem}
            </Notice>
          )}
          {sections.map((section) => (
            <Part key={section.heading} section={section} />
          ))}
          {details?.kind === 'video' && <ProxyInfo mediaId={media.id} controls={false} />}
        </div>
      )}
    </Dialog>
  );
}

/** One part of the window: its heading, then a line for each thing it says. */
function Part({ section }: { section: DetailSection }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-1.5 text-sm font-bold">
        {section.heading}
      </h3>
      <dl className="space-y-1 text-sm">
        {section.rows.map((row) => (
          <div key={row.label} data-label={row.label} className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted">{row.label}</dt>
            <dd className="min-w-0 flex-1 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
