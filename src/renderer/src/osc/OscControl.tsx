import { useState } from 'react';
import type { OscStatus } from '../../../shared/osc';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Textarea, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { useMode } from '../operator/mode-store';
import { closeOsc, openOsc, saveOsc, useOsc } from './osc-store';

/** Keep the enabled door visible even with OSC control's section folded away, in either mode. */
export function OscBadge() {
  const status = useOsc((s) => s.status);
  if (!status?.settings.enabled) return null;
  return (
    <Button
      size="sm"
      variant={status.state === 'listening' ? 'ghost' : 'warning'}
      data-testid="osc-badge"
      onClick={openOsc}
    >
      {status.state === 'listening' ? 'OSC on' : 'OSC needs attention'}
    </Button>
  );
}

export function OscControl() {
  const { open, status, error } = useOsc();
  const pro = useMode((s) => s.mode === 'pro');
  if (!open) return null;
  if (!status)
    return (
      <Dialog title="OSC control" onClose={closeOsc} closeLabel="Close OSC" testId="osc-dialog">
        {error ? <Notice tone="danger">{error}</Notice> : <p role="status">Loading OSC settings…</p>}
      </Dialog>
    );
  return <OscDialog key={pro ? 'pro' : 'simple'} status={status} error={error} pro={pro} />;
}

function OscDialog({ status, error, pro }: { status: OscStatus; error: string | null; pro: boolean }) {
  const [enabled, setEnabled] = useState(status.settings.enabled);
  const [port, setPort] = useState(String(status.settings.port));
  const [senders, setSenders] = useState(status.settings.senders.join('\n'));
  const [busy, setBusy] = useState(false);
  const save = async (off = false) => {
    setBusy(true);
    await saveOsc(
      off
        ? { ...status.settings, enabled: false }
        : {
            enabled,
            port: Number(port),
            senders: senders
              .split(/[\n,]+/u)
              .map((a) => a.trim())
              .filter(Boolean),
          },
    );
    if (off) setEnabled(false);
    setBusy(false);
  };
  return (
    <Dialog
      title="OSC control"
      subtitle="Let a sound or lighting console run the show over the local network."
      size="md"
      onClose={closeOsc}
      testId="osc-dialog"
      closeLabel="Close OSC"
      bodyClassName="space-y-4"
    >
      <p className="text-sm text-muted">
        OSC has no password. Use a trusted private network and list only the senders you trust. Nothing
        listens until you enable it and save.
      </p>
      {!pro && <Notice tone="warning">Set up OSC in Pro Mode on this computer.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {status.message && <Notice tone="warning">{status.message}</Notice>}
      <p role="status" className="text-sm" data-testid="osc-state">
        {status.state === 'listening'
          ? 'Listening for listed senders'
          : status.state === 'failed'
            ? 'Could not listen'
            : status.state === 'starting'
              ? 'Starting…'
              : 'OSC is off'}
      </p>
      <Toggle
        label="Enable OSC control"
        checked={enabled}
        onChange={setEnabled}
        disabled={!pro || busy}
        data-testid="osc-enabled"
      />
      <Field label="UDP port" hint="9000 unless your console uses another port; 1024 to 65535.">
        <TextInput
          inputMode="numeric"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          disabled={!pro || busy}
          data-testid="osc-port"
        />
      </Field>
      <Field
        label="Allowed sender addresses"
        hint="One local IPv4 address per line. 127.0.0.1 means this computer. No names or address ranges."
      >
        <Textarea
          rows={3}
          value={senders}
          onChange={(e) => setSenders(e.target.value)}
          disabled={!pro || busy}
          data-testid="osc-senders"
        />
      </Field>
      <p className="text-xs text-muted">
        The API guide lists the /drashti/ addresses. Drashti sends no OSC replies. Simple Mode keeps its usual
        limits.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            void save();
          }}
          disabled={!pro || busy}
          data-testid="osc-save"
        >
          Save OSC settings
        </Button>
        {status.settings.enabled && (
          <Button
            variant="secondary"
            onClick={() => {
              void save(true);
            }}
            disabled={!pro || busy}
            data-testid="osc-off"
          >
            Turn OSC off
          </Button>
        )}
      </div>
      <p className="text-xs text-muted" data-testid="osc-counts">
        {status.actions} actions run · {status.dropped} packets or actions refused · {status.pending} waiting
      </p>
    </Dialog>
  );
}
