import { useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/format';
import type { LinkQuality, LinkView } from '../../../shared/links';
import {
  aboveTheUsual,
  checkLink,
  heightLabel,
  linkKind,
  linkQualities,
  qualityWords,
} from '../../../shared/links';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Checkbox } from '../ui/Toggle';
import { Download, FolderOpen } from '../ui/icons';
import { closeLinkDialog, connectLinks, importLink, lookLink, stopDownload, useLinks } from './link-store';

/** Metadata is checked on paste; only Download starts a download. */
function LinkWindow({ audio }: { audio: boolean }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [edited, setEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captionChoice, setCaptionChoice] = useState<boolean | null>(null);
  const [qualityPick, setQualityPick] = useState<number | null>(null);
  const view = useLinks((state) => state.view);
  const problem = useLinks((state) => state.problem);
  const kind = linkKind(text);
  const check = kind ? checkLink(kind, text) : null;
  const current = check?.ok && view?.link === check.url;
  const validation = !text.trim()
    ? null
    : kind === null
      ? 'Paste a share link from YouTube or Dropbox.'
      : check && !check.ok
        ? check.message
        : null;
  const extension =
    kind === 'youtube'
      ? audio
        ? '.mp3'
        : '.mp4'
      : current && view.look?.shape === 'file'
        ? (/\.[^.]+$/u.exec(view.look.name)?.[0] ?? '')
        : '';
  const downloadCaptions = captionChoice ?? view?.downloadCaptions ?? true;
  const captionCount =
    current && view.look?.video
      ? new Set((view.look.video.captions ?? []).map((track) => track.language)).size
      : null;
  // Quality (alpha.24): once a YouTube link is checked, what it offers; none for Dropbox (one quality) or no heights.
  const qualities = current && view.look?.video ? linkQualities(view.look.video, audio) : null;
  const quality = qualities?.options.some((option) => option.value === qualityPick)
    ? qualityPick
    : (qualities?.initial ?? null);
  // Above the 1080p it begins with, by the short side of the picture (hunt S3-2: an upright 1080 × 1920 is not).
  const above = current && view.look?.video && quality !== null ? aboveTheUsual(view.look.video, quality) : false;
  useEffect(() => {
    if (!text.trim() || submitting) return;
    const timer = setTimeout(() => {
      void lookLink(text);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, submitting]);
  const displayedName = edited ? name : current ? (view.suggestedName ?? '') : '';

  function changeLink(value: string) {
    setText(value);
    setName('');
    setEdited(false);
    setQualityPick(null);
    useLinks.setState({ problem: null });
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    const options = {
      name: displayedName,
      captions: downloadCaptions,
      ...(quality === null || !qualities?.options.length ? {} : { quality }),
    };
    if (await importLink(text, options)) closeLinkDialog();
    else setSubmitting(false);
  }
  return (
    <Dialog
      title={audio ? 'Import YouTube sound (MP3)' : 'Import from a Link'}
      size="md"
      testId="link-paste"
      onClose={submitting ? null : closeLinkDialog}
      footer={
        <>
          <Button disabled={submitting} onClick={closeLinkDialog}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="link-download-form"
            data-testid="link-download"
            disabled={submitting || !check?.ok}
          >
            Download
          </Button>
        </>
      }
    >
      <form
        id="link-download-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="YouTube or Dropbox link" error={validation}>
          <TextInput
            data-autofocus
            data-testid="link-text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={text}
            onChange={(event) => changeLink(event.target.value)}
            onPaste={(event) => {
              event.preventDefault();
              changeLink(event.clipboardData.getData('text/plain'));
            }}
          />
        </Field>
        <Field
          label="Name"
          hint={
            current && view.waitingFor
              ? 'The title comes when the stream stops. You may type a name now.'
              : 'You can change the name. Drashti keeps the file type.'
          }
        >
          <div className="flex items-center gap-2">
            <TextInput
              data-testid="link-name"
              className="flex-1"
              value={displayedName}
              placeholder="The title appears after checking the link"
              onChange={(event) => {
                setEdited(true);
                setName(event.target.value);
              }}
            />
            {extension && <span className="text-sm text-muted">{extension}</span>}
          </div>
        </Field>
        <Field label="Save in">
          <div className="flex min-w-0 items-center gap-2">
            <TextInput data-testid="link-folder" className="flex-1" readOnly value={view?.folder ?? ''} />
            <Button data-testid="link-choose-folder" onClick={() => void window.drashti.links.pickFolder()}>
              Choose…
            </Button>
          </div>
        </Field>
        {qualities && qualities.options.length > 0 && quality !== null && (
          <Field
            label="Quality"
            hint={
              audio
                ? 'Best keeps all of the video’s sound; a lower one makes a smaller file.'
                : above
                  ? 'Above 1080p: a bigger file, harder to play smoothly, for little the hall can see.'
                  : 'To begin with, the best up to 1080p.'
            }
          >
            <Select
              data-testid="link-quality"
              value={String(quality)}
              onChange={(event) => setQualityPick(Number(event.target.value))}
            >
              {qualities.options.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {qualityLabel(option)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind === 'youtube' && (
          <div className="space-y-2">
            <Checkbox
              data-testid="link-captions"
              label="Download its captions"
              checked={downloadCaptions}
              onChange={(event) => setCaptionChoice(event.target.checked)}
            />
            {captionCount !== null && (
              <p data-testid="link-caption-count" role="status" className="text-xs text-muted">
                {captionCount
                  ? `Captions: ${String(captionCount)} ${captionCount === 1 ? 'language' : 'languages'}`
                  : 'Captions: none available'}
              </p>
            )}
            {downloadCaptions && (
              <Field
                label="Captions for learning"
                hint="A second copy, with the video’s details, in a folder for each video."
              >
                <div className="flex min-w-0 items-center gap-2">
                  <TextInput
                    data-testid="link-captions-folder"
                    className="flex-1"
                    readOnly
                    value={view?.captionsFolder ?? ''}
                  />
                  <Button
                    data-testid="link-choose-captions-folder"
                    onClick={() => void window.drashti.links.pickFolder('captions')}
                  >
                    Choose…
                  </Button>
                </div>
              </Field>
            )}
          </div>
        )}
        {problem && (
          <p role="alert" data-testid="link-problem" className="text-sm text-danger-fg">
            {problem}
          </p>
        )}
        {current && !problem && (
          <p role="status" className="text-xs text-muted">
            {view.waitingFor
              ? 'Checking the link waits while the stream is on air or recording. Download queues it.'
              : view.phase === 'looking'
                ? 'Checking link…'
                : (view.message ?? 'Ready to download.')}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** A Quality choice in words, with about how big its file is when that is known: "720p, about 25.3 MB". */
const qualityLabel = (option: LinkQuality): string =>
  option.bytes === null ? option.label : `${option.label}, about ${formatBytes(option.bytes)}`;

export function LinkDialog() {
  const open = useLinks((state) => state.open);
  const audio = useLinks((state) => state.audio !== null);
  useEffect(connectLinks, []);
  return open ? <LinkWindow audio={audio} /> : null;
}

function linkProgress(view: LinkView): string | null {
  switch (view.phase) {
    case 'looking':
      if (view.waitingFor) return 'Link check waits while the stream is in use';
      return view.look ? 'Checking where to save the download…' : 'Checking link…';
    case 'waiting':
      return 'Download waits while the stream is in use';
    case 'downloading': {
      const progress = view.progress;
      const percent = progress?.total
        ? ` ${String(Math.round((100 * progress.done) / progress.total))}%`
        : '';
      // A YouTube download says its quality too (alpha.24): "Downloading from YouTube 42%, 720p".
      // An upright video's as its Quality names it (hunt S3-2: 1080 × 1920 is 1080p).
      const quality =
        view.kind === 'youtube' && view.choice ? `, ${qualityWords(view.choice, view.look?.video)}` : '';
      return `Downloading from ${view.kind === 'youtube' ? 'YouTube' : 'Dropbox'}${percent}${quality}`;
    }
    case 'unpacking':
      return 'Unpacking download…';
    case 'converting':
      return view.waitingFor ?? `Making video ${heightLabel(view.maxHeight)}…`;
    case 'importing':
      return 'Importing download…';
    default:
      return null;
  }
}

export function LinkStatus({ platform }: { platform: string }) {
  const view = useLinks((state) => state.view);
  if (!view) return null;
  const text = linkProgress(view);
  const showSaved = view.saved !== null && (view.phase === 'done' || view.phase === 'failed');
  if (!text && !showSaved) return null;
  const canStop = ['looking', 'waiting', 'downloading', 'unpacking'].includes(view.phase);
  const savedLabel = platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer';
  return (
    <div data-testid="link-status" data-phase={view.phase} className="flex min-w-0 items-center gap-1.5">
      {text && (
        <span role="status" title={text} className="flex min-w-0 items-center gap-1.5 text-accent">
          <Download size={13} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{text}</span>
        </span>
      )}
      {canStop && (
        <Button size="sm" className="h-5" data-testid="link-stop" onClick={() => void stopDownload()}>
          Stop
        </Button>
      )}
      {showSaved && (
        <Button
          size="sm"
          icon={FolderOpen}
          className="h-5 whitespace-nowrap"
          data-testid="link-show-saved"
          onClick={() => void window.drashti.links.showSaved(null)}
        >
          {savedLabel}
        </Button>
      )}
    </div>
  );
}
