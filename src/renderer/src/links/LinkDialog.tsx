import { useEffect, useRef, useState } from 'react';
import type { LinkView } from '../../../shared/links';
import { heightLabel } from '../../../shared/links';
import { Button, IconButton } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Download, FolderOpen, X } from '../ui/icons';
import { closeLinkDialog, connectLinks, importLink, stopDownload, useLinks } from './link-store';

/** The link is pasted into the operator window and starts on the paste. */
function LinkPaste({ audio }: { audio: boolean }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => {
      if (document.activeElement === document.body && previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  async function submit(value: string) {
    if (submitting) return;
    setSubmitting(true);
    if (await importLink(value)) closeLinkDialog();
    else setSubmitting(false);
  }

  return (
    <form
      aria-label="Import from a Link"
      data-testid="link-paste"
      className="mx-auto my-1 flex w-[min(38rem,calc(100%-1.5rem))] shrink-0 items-center gap-2 rounded-md border border-line-strong bg-panel-2 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeLinkDialog();
        }
      }}
    >
      <Field
        label={audio ? 'Paste a link for Audio' : 'Paste a YouTube or Dropbox link'}
        layout="inline"
        className="min-w-0 flex-1"
      >
        <TextInput
          ref={input}
          data-testid="link-text"
          className="flex-1"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const value = event.clipboardData.getData('text/plain');
            event.preventDefault();
            setText(value);
            void submit(value);
          }}
        />
      </Field>
      <IconButton label="Close link input" icon={X} onClick={closeLinkDialog} />
    </form>
  );
}

export function LinkDialog() {
  const open = useLinks((state) => state.open);
  const audio = useLinks((state) => state.audio !== null);
  useEffect(connectLinks, []);
  return open ? <LinkPaste audio={audio} /> : null;
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
      return `Downloading from ${view.kind === 'youtube' ? 'YouTube' : 'Dropbox'}${percent}`;
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
