import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../../shared/format';
import {
  aboveTheSetting,
  checkLink,
  chosenHeight,
  heightLabel,
  LINK_HEIGHTS,
  type LinkKind,
  type LinkView,
  PERMISSION_WORDS,
  type VideoDetails,
} from '../../../shared/links';
import { useMode } from '../operator/mode-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, Select, TextInput } from '../ui/Field';
import { Cloud, Download, FolderOpen, Link2, MonitorPlay } from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { plural } from '../ui/text';
import { Checkbox } from '../ui/Toggle';
import { Truncate } from '../ui/Truncate';
import {
  anotherLink,
  choose,
  chooseKind,
  closeLinkDialog,
  connectLinks,
  lastPart,
  linkBusy,
  lookAtLink,
  pickSaveFolder,
  seeLinkReport,
  setMaxHeight,
  startDownload,
  stopDownload,
  useLinks,
} from './link-store';

/*
 * File › Import from a Link… (Session 25b, Pro Mode, an admin's): which kind
 * of link, the link, what it holds, where to save, Download. The files are
 * saved in that folder (Drashti never moves or deletes them), then imported
 * through the normal import. Closing this never stops a download: the status
 * bar shows it, and a press on that opens this again. YouTube (Session 25c):
 * MP4 or MP3, the quality up to the admin's setting, and the permission tick
 * each time.
 */

const KINDS: { id: LinkKind; label: string; hint: string; icon: Icon; ready: boolean }[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    hint: 'One video, as MP4 or MP3: only the mandir’s own, or one its owner allows us to use.',
    icon: MonitorPlay,
    ready: true,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    hint: 'A shared link to a file or a folder. Its PowerPoint files and MP4 videos are imported.',
    icon: Cloud,
    ready: true,
  },
];
const READY = KINDS.filter((k) => k.ready).map((k) => k.id);

/** Which kind of link: YouTube is shown, but cannot be picked yet (it says why). */
function KindChoice({ kind, locked }: { kind: LinkKind | null; locked: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label="Which kind of link"
      className="grid grid-cols-2 gap-2"
      onKeyDown={radioKeys(READY, kind ?? READY[0] ?? 'dropbox', (k) => {
        if (!locked) chooseKind(k);
      })}
    >
      {KINDS.map((k) => {
        const on = k.id === kind;
        const KindIcon = k.icon;
        const usable = k.ready && !locked;
        return (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={!usable || undefined}
            disabled={!k.ready}
            tabIndex={k.ready ? radioTabIndex(on, READY.indexOf(k.id), kind !== null) : -1}
            data-testid={`link-kind-${k.id}`}
            onClick={() => {
              if (usable) chooseKind(k.id);
            }}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-left',
              on ? 'border-accent bg-panel-3' : 'border-field bg-panel-2',
              usable && !on && 'hover:border-muted',
              // Shown, but not offered yet: a dashed edge, and it says so.
              !k.ready && 'cursor-not-allowed border-dashed',
            )}
          >
            <KindIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span
                className={cx(
                  'flex items-center gap-1.5 text-sm font-medium',
                  k.ready ? 'text-fg' : 'text-muted',
                )}
              >
                {k.label}
                {!k.ready && <Badge>Not yet</Badge>}
              </span>
              <span className="block text-xs text-muted" data-testid={`link-kind-${k.id}-hint`}>
                {k.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The link: checked as it is typed, and looked at once it is a link of the kind chosen. */
function LinkField({ kind, view, locked }: { kind: LinkKind; view: LinkView; locked: boolean }) {
  const [text, setText] = useState(view.link ?? '');
  // The text as it was when the typing or the paste stopped: only that is checked aloud.
  const [settled, setSettled] = useState(text);
  const asked = useRef<string | null>(view.link);
  useEffect(() => {
    if (locked) return;
    const timer = setTimeout(() => {
      setSettled(text);
      const check = checkLink(kind, text);
      if (!check.ok || asked.current === check.url) return;
      asked.current = check.url;
      void lookAtLink(kind, text);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [text, kind, locked]);
  const settledCheck = checkLink(kind, settled);
  const shownError =
    !locked && settled === text && settled.trim() !== '' && !settledCheck.ok ? settledCheck.message : null;
  const lookError = view.phase === 'idle' ? view.message : null;
  const error = shownError ?? lookError;
  return (
    <Field
      label={`Paste the ${kind === 'dropbox' ? 'Dropbox' : 'YouTube'} link`}
      // The help, until a problem is said (which carries its own help: never the same line twice).
      hint={
        error !== null
          ? undefined
          : kind === 'dropbox'
            ? 'In Dropbox, use Share, then Copy link.'
            : 'On YouTube, use Share, then Copy.'
      }
      error={error}
    >
      <TextInput
        data-testid="link-text"
        data-autofocus
        value={text}
        disabled={locked}
        placeholder={kind === 'dropbox' ? 'https://www.dropbox.com/…' : 'https://youtu.be/…'}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          asked.current = null;
        }}
      />
    </Field>
  );
}

/** What the link holds, as Dropbox says before the download. */
function Holds({ view }: { view: LinkView }) {
  if (view.phase === 'looking')
    return (
      <p className="text-sm text-muted" role="status" data-testid="link-looking">
        Looking at the link…
      </p>
    );
  const look = view.look;
  if (!look) return null;
  if (look.video)
    return (
      <div className="space-y-1 text-sm" data-testid="link-holds">
        <p>
          A video: <strong data-testid="link-name">{look.name}</strong>
          {look.video.duration !== null && (
            <span data-testid="link-duration"> ({formatDuration(look.video.duration)})</span>
          )}
          .
        </p>
        <p className="text-xs text-muted">
          Drashti saves the video itself, with no adverts: YouTube sends its adverts apart from the video. A
          sponsor message the maker speaks in the video is part of it: set markers to start and end the video
          round it.
        </p>
      </div>
    );
  return (
    <div className="space-y-1 text-sm" data-testid="link-holds">
      <p>
        {look.shape === 'folder' ? 'A folder: ' : 'A file: '}
        <strong data-testid="link-name">{look.name}</strong>
        {look.size !== null ? ` (${formatBytes(look.size)})` : ''}
        {look.shape === 'folder' ? '. Dropbox sends it as one zip, which Drashti unpacks.' : '.'}
      </p>
      <p className="text-xs text-muted">
        Only PowerPoint files (.pptx) and MP4 videos are imported, videos at {heightLabel(view.maxHeight)} at
        most. Everything else is saved, and listed as not taken.
      </p>
    </div>
  );
}

/** Where the files are saved. */
function SaveIn({ view, locked }: { view: LinkView; locked: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted">Save in</p>
      <div className="flex items-center gap-2">
        <FolderOpen size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <Truncate text={view.folder} className="min-w-0 flex-1 text-sm" data-testid="link-folder" />
        <Button
          size="sm"
          disabled={locked}
          data-testid="link-choose-folder"
          onClick={() => void pickSaveFolder()}
        >
          Choose…
        </Button>
      </div>
      <p className="text-xs text-faint">Drashti never moves or deletes what it saves there.</p>
    </div>
  );
}

/** 1:05, 12:00, 1:02:03. */
function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${String(h)}:${two(m)}:${two(s % 60)}` : `${String(m)}:${two(s % 60)}`;
}

const about = (bytes: number | null) => (bytes === null ? '' : `about ${formatBytes(bytes)}`);

/**
 * A YouTube video's choices (Session 25c): MP4 or MP3; for MP4 the qualities it offers, those above the
 * admin's setting shown but not to be picked, with why; and the permission tick, each time.
 */
function YouTubeChoices({ video, view, locked }: { video: VideoDetails; view: LinkView; locked: boolean }) {
  const choice = useLinks((s) => s.choice);
  const allowed = video.heights.filter((h) => h.height <= view.maxHeight);
  const above = video.heights.some((h) => h.height > view.maxHeight);
  // Until one is picked (or once the setting is below the one picked): the tallest the setting allows.
  const height = chosenHeight(video, view.maxHeight, choice.height);
  const types = [
    { id: 'mp4' as const, label: 'MP4', hint: 'The video' },
    { id: 'mp3' as const, label: 'MP3', hint: 'Its sound only' },
  ];
  return (
    <div className="space-y-3" data-testid="link-youtube">
      <div
        role="radiogroup"
        aria-label="Save it as"
        className="grid grid-cols-2 gap-2"
        onKeyDown={radioKeys(
          types.map((t) => t.id),
          choice.type,
          (t) => {
            if (!locked) choose({ type: t });
          },
        )}
      >
        {types.map((t, i) => {
          const on = choice.type === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={locked || undefined}
              tabIndex={radioTabIndex(on, i, true)}
              data-testid={`link-type-${t.id}`}
              onClick={() => {
                if (!locked) choose({ type: t.id });
              }}
              className={cx(
                'rounded-lg border px-3 py-2 text-left text-sm',
                on ? 'border-accent bg-panel-3' : 'border-field bg-panel-2',
              )}
            >
              <span className="font-medium">{t.label}</span>{' '}
              <span className="text-xs text-muted">{t.hint}</span>
            </button>
          );
        })}
      </div>
      {choice.type === 'mp4' ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted" id="link-quality-label">
            Quality
          </p>
          <div
            role="radiogroup"
            aria-labelledby="link-quality-label"
            className="flex flex-wrap gap-2"
            onKeyDown={radioKeys(
              allowed.map((h) => h.height),
              height ?? 0,
              (h) => {
                if (!locked) choose({ height: h });
              },
              // The heights above the setting come first and cannot be picked: find the chosen one's button.
              (h, group) => group.querySelector<HTMLElement>(`[data-testid="link-quality-${String(h)}"]`),
            )}
          >
            {video.heights.map((h) => {
              const usable = h.height <= view.maxHeight;
              const on = usable && h.height === height;
              return (
                <button
                  key={h.height}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={!usable || locked || undefined}
                  disabled={!usable}
                  tabIndex={usable ? radioTabIndex(on, allowed.indexOf(h), height !== null) : -1}
                  data-testid={`link-quality-${String(h.height)}`}
                  aria-describedby={usable ? undefined : 'link-quality-above'}
                  onClick={() => {
                    if (usable && !locked) choose({ height: h.height });
                  }}
                  className={cx(
                    'rounded-md border px-2.5 py-1.5 text-left text-sm',
                    on ? 'border-accent bg-panel-3' : 'border-field bg-panel-2',
                    !usable && 'cursor-not-allowed border-dashed text-muted',
                  )}
                >
                  {heightLabel(h.height)}
                  {h.bytes !== null && <span className="ml-1 text-xs text-muted">{about(h.bytes)}</span>}
                </button>
              );
            })}
          </div>
          {above && (
            <p className="text-xs text-muted" id="link-quality-above" data-testid="link-quality-above">
              {aboveTheSetting(view.maxHeight)}
            </p>
          )}
          {allowed.length === 0 && (
            <p className="text-xs text-warning-fg">
              Every quality this video offers is above the setting: an admin can raise it, or save the MP3.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted" data-testid="link-mp3-words">
          The best sound the video has{video.soundBytes !== null ? `, ${about(video.soundBytes)}` : ''}.
        </p>
      )}
      <Checkbox
        label={PERMISSION_WORDS}
        checked={choice.permission}
        disabled={locked}
        data-testid="link-permission"
        onChange={(e) => {
          choose({ permission: e.target.checked });
        }}
      />
    </div>
  );
}

/**
 * The admin's highest video quality, for YouTube and Dropbox both (Session 25c): kept with the library's
 * settings. Drashti has no Settings window, so it lives here, as the Updates dialog keeps its daily look.
 */
function HighestQuality({ view, locked }: { view: LinkView; locked: boolean }) {
  return (
    <Field
      label="Highest video quality"
      hint="An admin’s setting, for YouTube and Dropbox. A Dropbox video taller than this is imported as a copy this tall (the original stays as it came); a YouTube quality above it cannot be picked."
    >
      <Select
        data-testid="link-max-height"
        value={String(view.maxHeight)}
        disabled={locked}
        className="w-44"
        onChange={(e) => void setMaxHeight(Number(e.target.value))}
      >
        {LINK_HEIGHTS.map((h) => (
          <option key={h} value={h}>
            {heightLabel(h)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const STATUS: Partial<Record<LinkView['phase'], string>> = {
  downloading: 'Downloading',
  unpacking: 'Unpacking the folder…',
  importing: 'Importing what was saved…',
};

/** How the download goes: progress, the wait while on air, and Stop. */
function Going({ view }: { view: LinkView }) {
  const p = view.progress;
  const fraction = p?.total ? p.done / p.total : null;
  const most = heightLabel(view.maxHeight);
  let words = STATUS[view.phase] ?? '';
  if (view.phase === 'waiting')
    words = `Waiting: ${view.waitingFor ?? 'the stream is on air or recording'}. It goes on by itself afterwards.`;
  else if (view.phase === 'downloading' && p) {
    const what = view.choice
      ? view.choice.type === 'mp3'
        ? 'Downloading the MP3'
        : `Downloading the MP4, ${heightLabel(view.choice.height ?? 0)}`
      : 'Downloading';
    const of = view.choice ? 'of about' : 'of';
    words = p.total
      ? `${what}: ${formatBytes(Math.min(p.done, p.total))} ${of} ${formatBytes(p.total)}.`
      : `${what}: ${formatBytes(p.done)}.`;
  } else if (view.phase === 'converting')
    words = view.waitingFor
      ? `A video above ${most} waits to be made ${most}: ${view.waitingFor}. It goes on by itself afterwards.`
      : `Making a video above ${most} a ${most} copy for the library${fraction !== null ? `: ${String(Math.round(fraction * 100))}%` : '…'}`;
  return (
    <div className="space-y-2" role="status" data-testid="link-going" data-phase={view.phase}>
      {fraction !== null && view.phase !== 'importing' && (
        <Progress
          value={fraction}
          label={view.phase === 'converting' ? `Making the video ${most}` : 'Downloading the link'}
        />
      )}
      <p className="text-sm text-muted" data-testid="link-going-words">
        {words}
      </p>
      {view.phase !== 'importing' && view.phase !== 'converting' && (
        <Button size="sm" data-testid="link-stop" onClick={() => void stopDownload()}>
          Stop
        </Button>
      )}
      <p className="text-xs text-faint">
        You can close this: the download carries on, and the status bar shows how it goes.
      </p>
    </div>
  );
}

/** What was saved, what was not taken, and the way to the files and the report. */
function Saved({ view, platform }: { view: LinkView; platform: string }) {
  const saved = view.saved;
  if (!saved) return null;
  return (
    <div className="space-y-3" data-testid="link-saved">
      <div className="space-y-1">
        <p className="text-sm">
          Saved {plural(saved.files.length, 'file')} in <strong>{lastPart(saved.folder)}</strong>:
        </p>
        <Truncate text={saved.folder} className="text-xs text-muted" data-testid="link-saved-folder" />
        <ul
          className="max-h-32 list-disc overflow-auto pl-5 text-xs text-muted"
          data-testid="link-saved-files"
        >
          {saved.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      {view.fitted.length > 0 && (
        <div className="space-y-1" data-testid="link-fitted">
          <p className="text-sm font-medium">Made {heightLabel(view.maxHeight)}</p>
          <p className="text-xs text-muted">
            Above {heightLabel(view.maxHeight)}, so the library has a {heightLabel(view.maxHeight)} copy of
            each. The originals stay in the folder as they were.
          </p>
          <ul className="max-h-24 list-disc overflow-auto pl-5 text-xs">
            {view.fitted.map((f) => (
              <li key={f} data-testid="link-fitted-item">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.notTaken.length > 0 && (
        <div className="space-y-1" data-testid="link-not-taken">
          <p className="text-sm font-medium">Not taken</p>
          <ul className="max-h-32 overflow-auto text-xs">
            {view.notTaken.map((n) => (
              <li key={n.name} data-testid="link-not-taken-item">
                <span className="text-fg">{n.name}</span>: <span className="text-muted">{n.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={FolderOpen}
          data-testid="link-show-saved"
          onClick={() => void window.drashti.links.showSaved(null)}
        >
          {platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'}
        </Button>
        {view.runId && (
          <Button size="sm" data-testid="link-open-report" onClick={() => seeLinkReport(view.runId ?? '')}>
            See the import report
          </Button>
        )}
      </div>
    </div>
  );
}

export function LinkDialog({ platform }: { platform: string }) {
  const open = useLinks((s) => s.open);
  const view = useLinks((s) => s.view);
  const chosen = useLinks((s) => s.kind);
  const error = useLinks((s) => s.error);
  const choice = useLinks((s) => s.choice);
  const simple = useMode((s) => s.mode === 'simple');
  useEffect(() => {
    connectLinks();
  }, []);
  if (!open || !view || simple) return null;
  const busy = linkBusy(view);
  const finished = view.phase === 'done' || view.saved !== null;
  // While a download goes (or once one is finished) the dialog shows that one's kind and link.
  const kind = busy || finished || view.phase === 'looked' ? (view.kind ?? chosen) : chosen;
  const locked = busy || finished;
  const video = view.look?.video;
  // YouTube: a quality the setting allows (or the MP3), and the tick, each time.
  const youtubeReady =
    !video ||
    (choice.permission && (choice.type === 'mp3' || video.heights.some((h) => h.height <= view.maxHeight)));
  const canDownload =
    !busy &&
    view.saved === null &&
    view.look !== null &&
    youtubeReady &&
    (view.phase === 'looked' || view.phase === 'failed' || view.phase === 'stopped');
  return (
    <Dialog
      title="Import from a Link"
      size="md"
      onClose={closeLinkDialog}
      closeLabel="Close Import from a Link"
      testId="link-dialog"
      footer={
        <>
          {finished && !busy && (
            <Button
              className="mr-auto"
              icon={Link2}
              data-testid="link-another"
              onClick={() => void anotherLink()}
            >
              Another link
            </Button>
          )}
          <Button onClick={closeLinkDialog}>Close</Button>
          {!finished && (
            <Button
              variant="primary"
              icon={Download}
              disabled={!canDownload}
              data-testid="link-download"
              onClick={() => void startDownload()}
            >
              {view.phase === 'failed' || view.phase === 'stopped' ? 'Download again' : 'Download'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4" data-testid="link-body" data-phase={view.phase}>
        <KindChoice kind={kind} locked={locked} />
        <HighestQuality view={view} locked={busy} />
        {kind && (
          // A new kind starts the link box afresh.
          <LinkField
            key={`${kind}:${view.link ?? ''}:${locked ? 'locked' : ''}`}
            kind={kind}
            view={view}
            locked={locked}
          />
        )}
        <Holds view={view} />
        {view.look?.video && !finished && (
          <YouTubeChoices video={view.look.video} view={view} locked={busy} />
        )}
        {view.look && !finished && <SaveIn view={view} locked={locked} />}
        {busy && <Going view={view} />}
        {(view.phase === 'failed' || view.phase === 'stopped') && view.message && (
          <Notice tone={view.phase === 'failed' ? 'warning' : 'info'} role="alert" data-testid="link-message">
            {view.message}
          </Notice>
        )}
        {view.phase === 'done' && view.message && (
          <Notice tone="info" data-testid="link-message">
            {view.message}
          </Notice>
        )}
        <Saved view={view} platform={platform} />
        {error && (
          <p role="alert" className="text-sm text-warning-fg" data-testid="link-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The status bar's word about a download from a link (Pro Mode): a press opens the dialog. */
export function LinkStatus() {
  const view = useLinks((s) => s.view);
  const simple = useMode((s) => s.mode === 'simple');
  useEffect(() => {
    connectLinks();
  }, []);
  if (simple || !view) return null;
  const p = view.progress;
  const percent = p?.total ? ` ${String(Math.round((p.done / p.total) * 100))}%` : '';
  const text =
    view.phase === 'waiting'
      ? 'Download waits: on air or recording'
      : view.phase === 'downloading'
        ? `Downloading from ${view.kind === 'youtube' ? 'YouTube' : 'a link'}${percent}`
        : view.phase === 'unpacking'
          ? 'Unpacking a download'
          : view.phase === 'converting'
            ? `Making a downloaded video ${heightLabel(view.maxHeight)}`
            : view.phase === 'importing'
              ? 'Importing a download'
              : view.phase === 'failed'
                ? 'A download from a link stopped'
                : null;
  if (!text) return null;
  return (
    <button
      type="button"
      data-testid="link-status"
      data-phase={view.phase}
      onClick={() => {
        useLinks.setState({ open: true });
      }}
      className={cx(
        'flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:text-fg',
        view.phase === 'failed' ? 'text-warning-fg' : 'text-accent',
      )}
    >
      <Download size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}
