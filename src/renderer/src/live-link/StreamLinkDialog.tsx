import { useEffect, useState } from 'react';
import { checkStreamLink, STREAM_LINK_KINDS } from '../../../shared/live-link';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { MonitorPlay } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { closeStreamLink, useStreamLinkUi } from './live-link-store';

/*
 * Show a Stream Link… (alpha.20, the playback set's slice 8; the owner's Q60-39 P3 A): paste an HLS link or a YouTube
 * live stream's link, checked as it is typed, and Show on the screens. Nothing goes up until its pictures come; then it
 * is the background on this computer's screens, its sound in the hall, and Drashti's own stream shows the Wallpaper
 * meanwhile. The last link shown (this run only: a link can hold a token, so it is never written down) is offered
 * again.
 */

export function StreamLinkDialog() {
  const open = useStreamLinkUi((s) => s.open);
  if (!open) return null;
  return <StreamLinkWindow />;
}

function StreamLinkWindow() {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The last link shown, offered again (only while nothing has been typed).
  useEffect(() => {
    let live = true;
    void window.drashti.liveLink.last().then((last) => {
      if (live && last !== null) setText((now) => (now === '' ? last : now));
    });
    return () => {
      live = false;
    };
  }, []);
  const check = checkStreamLink(text);
  const validation = typed && text.trim() !== '' && !check.ok ? check.message : null;
  const close = () => {
    if (busy) void window.drashti.liveLink.stop();
    closeStreamLink();
  };
  const show = async () => {
    if (!check.ok || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await window.drashti.liveLink.show(text);
    setBusy(false);
    if (result.ok) closeStreamLink();
    else if (result.message !== 'Stopped.') setProblem(result.message);
  };
  return (
    <Dialog
      title="Show a Stream Link"
      subtitle="A live stream on the hall’s screens, as the background, with its sound in the hall. Drashti only receives it, and Drashti’s own stream shows the Wallpaper while it is up."
      onClose={close}
      closeLabel="Close Show a Stream Link"
      size="md"
      testId="stream-link-dialog"
      footer={
        <>
          {busy ? (
            <Button data-testid="stream-link-stop" onClick={() => void window.drashti.liveLink.stop()}>
              Stop
            </Button>
          ) : (
            <Button onClick={close}>Cancel</Button>
          )}
          <Button
            variant="primary"
            icon={MonitorPlay}
            data-testid="stream-link-show"
            disabled={!check.ok || busy}
            onClick={() => void show()}
          >
            {busy ? 'Connecting…' : 'Show on the screens'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <Notice tone="danger" compact data-testid="stream-link-problem">
            {problem}
          </Notice>
        )}
        <Field label="Stream link" hint={STREAM_LINK_KINDS} error={validation}>
          <TextInput
            data-autofocus
            data-testid="stream-link-text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setTyped(true);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void show();
            }}
          />
        </Field>
        <p className="text-xs text-muted">
          Nothing goes up until its pictures come. If it drops, the screens keep its last picture while
          Drashti connects again by itself; after 20 seconds the Wallpaper goes up, and the link comes back by
          itself when it does, unless something else has gone up. Clear background takes it off at any time.
        </p>
      </div>
    </Dialog>
  );
}
