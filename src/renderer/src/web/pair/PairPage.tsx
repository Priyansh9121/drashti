import { useEffect, useState } from 'react';
import { BYE_TEXT, type ByeReason, DEVICE_KIND_LABEL, type DeviceKind } from '../../../../shared/network';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { api, current, keepPairing, PAGE_OF } from '../device';

/*
 * Pairing a phone, tablet or browser: the code the operator's window shows
 * (typed, or carried in the QR code's #fragment, which never reaches a
 * server) for this device's own token. Then on to the device's page.
 */

const why = (): ByeReason | null => {
  const w = new URLSearchParams(location.search).get('why');
  return w && w in BYE_TEXT ? (w as ByeReason) : null;
};

/** The code in the address (#c=123456), taken out of it at once. */
function codeFromAddress(): string | null {
  const match = /^#c=(\d{6})$/u.exec(location.hash);
  if (!match?.[1]) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}

/** Read once, as the page opens. */
const FROM_QR = codeFromAddress();

export function PairPage() {
  const [code, setCode] = useState(FROM_QR ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; kind: DeviceKind } | null>(null);
  const reason = why();

  const pair = async (typed: string) => {
    const digits = typed.replace(/\D/gu, '');
    if (digits.length !== 6) {
      setProblem('Type the six numbers Drashti shows.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const r = await api<{ token: string; device: { name: string; kind: DeviceKind } }>('/api/v1/pair', {
      method: 'POST',
      body: { code: digits },
    });
    setBusy(false);
    if (!r.ok) {
      setProblem(r.message);
      return;
    }
    keepPairing({ token: r.token, name: r.device.name, kind: r.device.kind });
    setDone(r.device);
    location.replace(PAGE_OF[r.device.kind]);
  };

  useEffect(() => {
    if (FROM_QR) {
      void Promise.resolve(FROM_QR).then(pair);
      return;
    }
    // Already paired: straight to this device's page, if Drashti still knows it.
    const known = current();
    if (known && !reason)
      void api<{ device: { kind: DeviceKind } }>('/api/v1/me').then((r) => {
        if (r.ok) location.replace(PAGE_OF[r.device.kind]);
      });
    // Once, as the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-8" data-testid="pair-page">
      <header className="space-y-1">
        <p className="text-base font-bold tracking-wide text-muted">Drashti</p>
        <h1 className="text-2xl font-bold text-fg">Pair this device</h1>
      </header>
      {reason && <Notice tone="warning">{BYE_TEXT[reason]}</Notice>}
      {done ? (
        <p className="text-lg text-fg" role="status">
          Paired as {DEVICE_KIND_LABEL[done.kind]} “{done.name}”. Opening…
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void pair(code);
          }}
        >
          <label className="block space-y-2">
            <span className="block text-base text-fg">The code Drashti shows</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123 456"
              aria-invalid={problem ? true : undefined}
              data-testid="pair-code"
              className="h-16 w-full rounded-lg border border-field bg-panel-2 px-4 text-center font-mono text-3xl tracking-widest text-fg placeholder:text-faint aria-invalid:border-danger"
            />
          </label>
          {problem && (
            <p className="text-base text-danger-fg" role="alert">
              {problem}
            </p>
          )}
          <Button type="submit" variant="primary" size="xl" disabled={busy} className="w-full">
            {busy ? 'Pairing…' : 'Pair'}
          </Button>
        </form>
      )}
      <p className="text-sm text-muted">
        Ask the operator for a code: in Drashti, Phones, then Pair a device. A code works once, for two
        minutes. This phone must be on the same Wi-Fi as the computer running Drashti.
      </p>
    </main>
  );
}
