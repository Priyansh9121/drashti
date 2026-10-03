import { useState } from 'react';
import {
  DEVICE_KIND_HELP,
  DEVICE_KIND_LABEL,
  DEVICE_KINDS,
  type DeviceInfo,
  type DeviceKind,
  type NetworkStatus,
} from '../../../shared/network';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, NumberInput, TextInput } from '../ui/Field';
import { Megaphone, Pencil, Printer, Smartphone, TabletSmartphone, Trash2 } from '../ui/icons';
import type { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Toggle } from '../ui/Toggle';
import { useNow } from '../render/useNow';
import { closeNetwork, networkAction, useNetwork } from './network-store';
import { QrCode } from './QrCode';

/*
 * The local network's panel (Pro Mode): on or off, the address a phone
 * opens, pairing a device with a QR code or a code to type, the paired
 * devices (renamed, removed), and the announcements poster. A sheet on the
 * right, like Screens and Stream.
 */

const KIND_ICON: Record<DeviceKind, Icon> = {
  remote: Smartphone,
  stage: TabletSmartphone,
  announcements: Megaphone,
};

/** "just now", "5 min ago", "3 h ago", or the date. */
export function seenWords(iso: string | null, now: number): string {
  if (!iso) return 'Not seen yet';
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'Seen just now';
  if (ms < 3_600_000) return `Seen ${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `Seen ${Math.floor(ms / 3_600_000)} h ago`;
  return `Seen ${new Date(iso).toLocaleDateString()}`;
}

const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

function OnOff({ status }: { status: NetworkStatus }) {
  const [port, setPort] = useState(String(status.port));
  const listening = status.state === 'listening';
  return (
    <section className="space-y-3">
      <Toggle
        size="lg"
        checked={status.on}
        label="Let paired phones and tablets connect"
        onChange={(on) => void networkAction(() => window.drashti.network.setOn(on))}
        data-testid="network-switch"
      />
      <div className="text-sm" data-testid="network-state" aria-live="polite">
        {!status.on && <p className="text-muted">Off. Nothing on the network can reach Drashti.</p>}
        {status.state === 'starting' && <p className="text-muted">Starting…</p>}
        {listening && (
          <div className="space-y-1">
            <p className="text-fg">On. On a phone connected to this computer’s Wi-Fi, open:</p>
            <ul className="space-y-0.5" data-testid="network-addresses">
              {[...status.addresses, ...(status.localName ? [status.localName] : [])].map((a) => (
                <li key={a} className="font-mono text-sm text-fg select-all">
                  {a}
                </li>
              ))}
              {status.addresses.length === 0 && (
                <li className="text-warning-fg">This computer is not on a network now.</li>
              )}
            </ul>
            {status.localName && (
              <p className="text-xs text-faint">
                The name ending “.local” keeps working if the number changes, but not every phone knows it.
              </p>
            )}
          </div>
        )}
      </div>
      {status.state === 'failed' && status.message && <Notice tone="warning">{status.message}</Notice>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void networkAction(() => window.drashti.network.setPort(Number(port)));
        }}
      >
        <Field label="Port" hint="1024 to 65535; paired phones need pairing again after a change.">
          <NumberInput
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            data-testid="network-port"
          />
        </Field>
        <Button type="submit" disabled={Number(port) === status.port}>
          Use this port
        </Button>
      </form>
    </section>
  );
}

function Pairing({ status }: { status: NetworkStatus }) {
  const now = useNow(1000);
  const [name, setName] = useState('');
  const offer = status.pairing;
  if (status.state !== 'listening')
    return (
      <section className="space-y-2">
        <SectionTitle>Pair a device</SectionTitle>
        <p className="text-sm text-muted">Turn the network on to pair a phone or tablet.</p>
      </section>
    );
  if (offer) {
    const left = Math.max(0, Math.ceil((offer.expiresAt - now) / 1000));
    return (
      <section className="space-y-3" data-testid="pairing-offer">
        <SectionTitle>Pair “{offer.name}”</SectionTitle>
        <div className="flex flex-wrap items-center gap-4">
          <QrCode text={offer.url} label={`QR code that pairs a ${DEVICE_KIND_LABEL[offer.kind]} device`} />
          <div className="min-w-0 space-y-2">
            <p className="text-sm text-muted">
              Scan it with the phone’s camera, or open the address above and type:
            </p>
            <p className="font-mono text-4xl font-bold tracking-widest text-fg" data-testid="pairing-code">
              {spaced(offer.code)}
            </p>
            <p className="text-xs text-muted" aria-live="off">
              Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. It becomes a{' '}
              {DEVICE_KIND_LABEL[offer.kind]} device: {DEVICE_KIND_HELP[offer.kind].toLowerCase()}
            </p>
            <Button onClick={() => void networkAction(() => window.drashti.network.cancelPairing())}>
              Cancel
            </Button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <SectionTitle>Pair a device</SectionTitle>
      <Field label="Name (optional)" hint="So you can tell devices apart: “Lead singer’s tablet”.">
        <TextInput
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          data-testid="pair-name"
        />
      </Field>
      <div className="grid gap-2">
        {DEVICE_KINDS.map((kind) => {
          const KindIcon = KIND_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              data-testid={`pair-${kind}`}
              onClick={() =>
                void networkAction(() =>
                  window.drashti.network.startPairing(kind, name.trim() || undefined),
                ).then((r) => {
                  if (r.ok) setName('');
                })
              }
              className="flex items-start gap-3 rounded-lg border border-field bg-panel-2 px-3 py-2 text-left hover:border-muted"
            >
              <KindIcon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">
                  Pair a {DEVICE_KIND_LABEL[kind]} device
                </span>
                <span className="block text-xs text-muted">{DEVICE_KIND_HELP[kind]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DeviceRow({ device, now }: { device: DeviceInfo; now: number }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [removing, setRemoving] = useState(false);
  const KindIcon = KIND_ICON[device.kind];
  return (
    <li
      className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2"
      data-testid="device-row"
    >
      <KindIcon size={16} aria-hidden="true" className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void networkAction(() => window.drashti.network.renameDevice(device.id, name)).then((r) => {
                if (r.ok) setRenaming(false);
              });
            }}
          >
            <TextInput
              aria-label={`New name for ${device.name}`}
              value={name}
              maxLength={60}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button size="sm" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <span className="block truncate text-sm text-fg">{device.name}</span>
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Badge tone="neutral">{device.poster ? 'Poster link' : DEVICE_KIND_LABEL[device.kind]}</Badge>
          <span className={cx(device.connected ? 'text-success-fg' : 'text-muted')} data-testid="device-seen">
            {device.connected ? 'Connected' : seenWords(device.lastSeenAt, now)}
          </span>
        </span>
      </div>
      {!renaming && !device.poster && (
        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setRenaming(true)}>
          Rename
        </Button>
      )}
      {!renaming && (
        <Button
          variant="ghost"
          size="sm"
          icon={Trash2}
          data-testid="remove-device"
          onClick={() => setRemoving(true)}
        >
          Remove
        </Button>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove “${device.name}”?`}
          confirmLabel="Remove"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void networkAction(() => window.drashti.network.revokeDevice(device.id));
          }}
          testId="remove-device-confirm"
        >
          <p>
            It is cut off at once{device.poster ? ', and the printed posters stop working' : ''}. To use it
            again, pair it again.
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}

function Devices({ status }: { status: NetworkStatus }) {
  const now = useNow(30_000);
  return (
    <section className="space-y-2">
      <SectionTitle>Paired devices</SectionTitle>
      {status.devices.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="device-list">
          {status.devices.map((d) => (
            <DeviceRow key={d.id} device={d} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Poster({ status }: { status: NetworkStatus }) {
  const existing = status.devices.find((d) => d.poster);
  const [replacing, setReplacing] = useState(false);
  const make = () => void networkAction(() => window.drashti.network.makePoster());
  return (
    <section className="space-y-2">
      <SectionTitle>Announcements poster</SectionTitle>
      <p className="text-sm text-muted">
        A QR code to print and put up: anyone who scans it can send an announcement, and nothing reaches the
        screens until you approve it.
      </p>
      {status.poster ? (
        <div
          className="print-poster space-y-2 rounded-lg border border-line bg-panel-2 p-3"
          data-testid="poster"
        >
          <div className="flex flex-wrap items-center gap-4">
            <QrCode text={status.poster.url} label="QR code for sending announcements" size={160} />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium text-fg">Send an announcement</p>
              <p className="text-xs text-muted">
                This link is shown only now: print it before you close Drashti. Making a new one stops this
                one.
              </p>
              <Button icon={Printer} onClick={() => window.print()} disabled={status.state !== 'listening'}>
                Print the poster
              </Button>
            </div>
          </div>
        </div>
      ) : existing ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1 text-muted">A poster link is in use.</span>
          <Button onClick={() => setReplacing(true)} disabled={status.state !== 'listening'}>
            Make a new one
          </Button>
        </div>
      ) : (
        <Button
          icon={Megaphone}
          onClick={make}
          disabled={status.state !== 'listening'}
          data-testid="make-poster"
        >
          Make a poster link
        </Button>
      )}
      {replacing && (
        <ConfirmDialog
          title="Make a new poster link?"
          confirmLabel="Make a new one"
          onCancel={() => setReplacing(false)}
          onConfirm={() => {
            setReplacing(false);
            make();
          }}
        >
          <p>Posters already printed stop working, and need printing again.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

export function NetworkPanel() {
  const status = useNetwork((s) => s.status);
  const error = useNetwork((s) => s.error);
  return (
    <Dialog
      title="Phones and tablets"
      subtitle="Paired phones, tablets and browsers on this Wi-Fi: a remote, a stage screen, announcements."
      placement="right"
      size="md"
      onClose={closeNetwork}
      closeLabel="Close phones and tablets"
      bodyClassName="space-y-6"
      testId="network-panel"
    >
      {error && (
        <Notice tone="danger" onDismiss={() => useNetwork.setState({ error: null })}>
          {error}
        </Notice>
      )}
      {status && (
        <>
          <OnOff status={status} />
          <Pairing status={status} />
          <Devices status={status} />
          <Poster status={status} />
          <p className="text-xs text-faint">
            If a phone cannot connect: it must be on the same Wi-Fi as this computer. The first time the
            network is on, the computer may ask whether Drashti may accept connections: choose Allow on a Mac,
            or Private networks on Windows.
          </p>
        </>
      )}
    </Dialog>
  );
}
