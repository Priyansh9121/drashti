import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../../shared/format';
import { checkLink, type LinkKind, type LinkView, YOUTUBE_NOT_YET } from '../../../shared/links';
import { useMode } from '../operator/mode-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Cloud, Download, FolderOpen, Link2, MonitorPlay } from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { radioKeys, radioTabIndex } from '../ui/radio';
import { plural } from '../ui/text';
import { Truncate } from '../ui/Truncate';
import { openReport } from '../library/import-store';
import {
  anotherLink,
  chooseKind,
  closeLinkDialog,
  connectLinks,
  lastPart,
  linkBusy,
  lookAtLink,
  pickSaveFolder,
  startDownload,
  stopDownload,
  useLinks,
} from './link-store';

/*
 * File › Import from a Link… (Session 25b, Pro Mode, an admin's): which kind
 * of link, the link, what it holds, where to save, Download. The files are
 * saved in that folder (Drashti never moves or deletes them), then imported
 * through the normal import. Closing this never stops a download: the status
 * bar shows it, and a press on that opens this again.
 */

const KINDS: { id: LinkKind; label: string; hint: string; icon: Icon; ready: boolean }[] = [
  { id: 'youtube', label: 'YouTube', hint: YOUTUBE_NOT_YET, icon: MonitorPlay, ready: false },
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
  return (
    <Field
      label={`Paste the ${kind === 'dropbox' ? 'Dropbox' : 'YouTube'} link`}
      hint={kind === 'dropbox' ? 'In Dropbox, use Share, then Copy link.' : undefined}
      error={shownError ?? lookError}
    >
      <TextInput
        data-testid="link-text"
        data-autofocus
        value={text}
        disabled={locked}
        placeholder="https://www.dropbox.com/…"
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
  return (
    <div className="space-y-1 text-sm" data-testid="link-holds">
      <p>
        {look.shape === 'folder' ? 'A folder: ' : 'A file: '}
        <strong data-testid="link-name">{look.name}</strong>
        {look.size !== null ? ` (${formatBytes(look.size)})` : ''}
        {look.shape === 'folder' ? '. Dropbox sends it as one zip, which Drashti unpacks.' : '.'}
      </p>
      <p className="text-xs text-muted">
        Only PowerPoint files (.pptx) and MP4 videos are imported, videos at 1080p at most. Everything else is
        saved, and listed as not taken.
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

const STATUS: Partial<Record<LinkView['phase'], string>> = {
  downloading: 'Downloading',
  unpacking: 'Unpacking the folder…',
  converting: 'Making a video 1080p…',
  importing: 'Importing what was saved…',
};

/** How the download goes: progress, the wait while on air, and Stop. */
function Going({ view }: { view: LinkView }) {
  const p = view.progress;
  const fraction = p?.total ? p.done / p.total : null;
  let words = STATUS[view.phase] ?? '';
  if (view.phase === 'waiting')
    words = `Waiting: ${view.waitingFor ?? 'the stream is on air or recording'}. It goes on by itself afterwards.`;
  else if (view.phase === 'downloading' && p)
    words = p.total
      ? `Downloading: ${formatBytes(p.done)} of ${formatBytes(p.total)}.`
      : `Downloading: ${formatBytes(p.done)}.`;
  else if (view.phase === 'converting')
    words = view.waitingFor
      ? `A video above 1080p waits to be made 1080p: ${view.waitingFor}. It goes on by itself afterwards.`
      : `Making a video above 1080p a 1080p copy for the library${fraction !== null ? `: ${String(Math.round(fraction * 100))}%` : '…'}`;
  return (
    <div className="space-y-2" role="status" data-testid="link-going" data-phase={view.phase}>
      {fraction !== null && view.phase !== 'importing' && (
        <Progress
          value={fraction}
          label={view.phase === 'converting' ? 'Making the video 1080p' : 'Downloading the link'}
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
          <p className="text-sm font-medium">Made 1080p</p>
          <p className="text-xs text-muted">
            Above 1080p, so the library has a 1080p copy of each. The originals stay in the folder as they
            were.
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
          <Button size="sm" data-testid="link-open-report" onClick={() => void openReport(view.runId ?? '')}>
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
  const canDownload =
    !busy &&
    view.saved === null &&
    view.look !== null &&
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
        ? `Downloading from a link${percent}`
        : view.phase === 'unpacking'
          ? 'Unpacking a download'
          : view.phase === 'converting'
            ? 'Making a downloaded video 1080p'
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
