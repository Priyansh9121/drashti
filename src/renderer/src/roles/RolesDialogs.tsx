import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { ADMIN_UNLOCK_MS, PIN_PATTERN, waitText } from '../../../shared/roles';
import { useNow } from '../render/useNow';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, TextInput } from '../ui/Field';
import { Lock, LockOpen } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Tooltip } from '../ui/Tooltip';
import { answerAdminPin, askAdminPin, closeRolesDialog, useRoles } from './roles-store';

/*
 * Roles in the operator window (Session 14): the admin PIN prompt, the
 * Roles and PINs dialog (File > Roles and PINs…), and the chip in the
 * header that says who is at the controls.
 */

/** A PIN field: digits only, never shown, never remembered by the browser. */
export function PinInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TextInput
      type="password"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={12}
      className="w-40 font-mono tracking-widest"
      {...props}
      onChange={(e) => {
        e.target.value = e.target.value.replace(/\D/gu, '');
        props.onChange?.(e);
      }}
    />
  );
}

/** "Try again in 0:45" while too many wrong PINs make it wait, else null. */
export function useWaitText(): string | null {
  const waitUntil = useRoles((s) => s.view.waitUntil);
  const now = useNow(1000);
  return waitUntil !== null && waitUntil > now ? waitText(waitUntil, now) : null;
}

/** The admin PIN prompt: a button or menu item needs admin. */
export function AdminPinDialog() {
  const asking = useRoles((s) => s.asking);
  // A fresh form each time it is asked (nothing typed is kept).
  return asking ? <AdminPinForm what={asking.what} /> : null;
}

function AdminPinForm({ what }: { what: string | null }) {
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useWaitText();
  const close = () => {
    answerAdminPin(false);
  };
  return (
    <Dialog
      title="Admin PIN"
      size="sm"
      onClose={close}
      closeButton={false}
      testId="admin-pin"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="admin-pin-form"
            data-testid="admin-pin-unlock"
            disabled={busy || pin.length < 4 || wait !== null}
          >
            Unlock
          </Button>
        </>
      }
    >
      <form
        id="admin-pin-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void window.drashti.roles.unlock(pin).then((result) => {
            setBusy(false);
            setPin('');
            if (result.ok) answerAdminPin(true);
            else setProblem(result.message);
          });
        }}
      >
        <p className="text-sm text-muted">
          {what ? `To ${what}, ` : 'This is for an admin: '}
          type the admin PIN. Admin then stays unlocked for {String(ADMIN_UNLOCK_MS / 60_000)} minutes after
          the last thing an admin does, or until Lock.
        </p>
        <Field label="Admin PIN" error={wait ? `Too many wrong PINs. Try again in ${wait}.` : problem}>
          <PinInput
            autoFocus
            data-testid="admin-pin-input"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** Who is at the controls (roles on): Operator, or Admin with its time left, and Lock. */
export function RoleChip() {
  const view = useRoles((s) => s.view);
  if (!view.on) return null;
  if (view.adminUntil !== null) return <AdminChip until={view.adminUntil} />;
  return <OperatorChip />;
}

/** Admin, with its time left (ticking only while it shows). */
function AdminChip({ until }: { until: number }) {
  const now = useNow(1000);
  if (until <= now) return <OperatorChip />;
  const left = waitText(until, now);
  return (
    <Tooltip content="Admin is unlocked. Lock it now, or it locks by itself." side="bottom">
      <Button
        variant="warning"
        icon={LockOpen}
        data-testid="role-chip"
        data-role="admin"
        aria-label={`Admin, unlocked for ${left}. Lock now`}
        onClick={() => void window.drashti.roles.lock()}
      >
        Admin {left}
      </Button>
    </Tooltip>
  );
}

function OperatorChip() {
  return (
    <Tooltip content="Running the show as an operator. Unlock admin with the admin PIN." side="bottom">
      <Button
        variant="ghost"
        icon={Lock}
        data-testid="role-chip"
        data-role="operator"
        onClick={() => void askAdminPin()}
      >
        Operator
      </Button>
    </Tooltip>
  );
}

const pinProblem = (pin: string, again: string): string | null => {
  if (pin === '') return null;
  if (!PIN_PATTERN.test(pin)) return 'A PIN is 4 to 12 digits.';
  if (again !== '' && again !== pin) return 'The two do not match.';
  return null;
};

/** A new PIN typed twice. */
function NewPin({
  label,
  pin,
  again,
  onPin,
  onAgain,
  testId,
}: {
  label: string;
  pin: string;
  again: string;
  onPin: (v: string) => void;
  onAgain: (v: string) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      <Field label={label} error={pinProblem(pin, again)}>
        <PinInput data-testid={`${testId}-pin`} value={pin} onChange={(e) => onPin(e.target.value)} />
      </Field>
      <Field label="Again">
        <PinInput data-testid={`${testId}-again`} value={again} onChange={(e) => onAgain(e.target.value)} />
      </Field>
    </div>
  );
}

const ready = (pin: string, again: string) => PIN_PATTERN.test(pin) && pin === again;

/** What each role does, in a few words. */
function RoleSummary() {
  return (
    <ul className="space-y-1.5 text-sm text-muted">
      <li>
        <strong className="text-fg">Volunteers</strong> run a sabha in Simple Mode, which changes nothing.
      </li>
      <li>
        <strong className="text-fg">Operators</strong> run the show in Pro Mode: playlists, words and slides,
        props, messages and timers, macros, Looks, announcements, going live and recording.
      </li>
      <li>
        <strong className="text-fg">Admins</strong> also set Drashti up: importing and removing, themes,
        Shastra texts, calendars, the idle rotation and every schedule, macros, screens, Looks, stage layouts,
        masks and sound, the stream’s settings and keys, phones and nodes, backups, restores and updates, and
        these PINs.
      </li>
    </ul>
  );
}

/** File > Roles and PINs…: turn roles on with two PINs, change one, or turn them off. */
export function RolesDialog() {
  const open = useRoles((s) => s.dialogOpen);
  const on = useRoles((s) => s.view.on);
  if (!open) return null;
  return on ? <RolesOn /> : <RolesOff />;
}

function RolesOff() {
  const [admin, setAdmin] = useState('');
  const [adminAgain, setAdminAgain] = useState('');
  const [operator, setOperator] = useState('');
  const [operatorAgain, setOperatorAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const same = admin !== '' && admin === operator;
  const can = ready(admin, adminAgain) && ready(operator, operatorAgain) && !same;
  return (
    <Dialog
      title="Roles and PINs"
      size="md"
      onClose={closeRolesDialog}
      closeLabel="Close roles and PINs"
      testId="roles-dialog"
      footer={
        <>
          <Button onClick={closeRolesDialog}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="roles-on-form"
            disabled={!can}
            data-testid="roles-turn-on"
          >
            Turn on roles
          </Button>
        </>
      }
    >
      <form
        id="roles-on-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void window.drashti.roles.setPins({ admin, operator }).then((result) => {
            if (result.ok) closeRolesDialog();
            else setProblem(result.message);
          });
        }}
      >
        <p className="text-sm">
          Roles are off: anyone in Pro Mode can change anything, and Simple Mode is left by typing “pro”. Two
          PINs turn them on.
        </p>
        <RoleSummary />
        <NewPin
          label="Admin PIN (4 to 12 digits)"
          pin={admin}
          again={adminAgain}
          onPin={setAdmin}
          onAgain={setAdminAgain}
          testId="roles-admin"
        />
        <NewPin
          label="Operator PIN"
          pin={operator}
          again={operatorAgain}
          onPin={setOperator}
          onAgain={setOperatorAgain}
          testId="roles-operator"
        />
        {same && <p className="text-sm text-danger-fg">The admin PIN and the operator PIN must differ.</p>}
        <Notice tone="info">
          With roles on, Drashti starts in Simple Mode, and leaving it takes a PIN: the operator PIN, or the
          admin PIN (which also unlocks setting up). Keep the admin PIN with whoever looks after Drashti.
        </Notice>
        {problem && (
          <p role="alert" className="text-sm text-danger-fg">
            {problem}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function RolesOn() {
  const [role, setRole] = useState<'admin' | 'operator' | null>(null);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const change = (r: 'admin' | 'operator') => {
    setRole(r);
    setPin('');
    setAgain('');
    setProblem(null);
    setDone(null);
  };
  return (
    <Dialog
      title="Roles and PINs"
      size="md"
      onClose={closeRolesDialog}
      closeLabel="Close roles and PINs"
      testId="roles-dialog"
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            data-testid="roles-turn-off"
            onClick={() => setTurningOff(true)}
          >
            Turn roles off
          </Button>
          <Button onClick={closeRolesDialog}>Close</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm">
          <Badge tone="success">On</Badge> Two PINs are set.
        </p>
        <RoleSummary />
        <div className="flex flex-wrap gap-2">
          <Button data-testid="roles-change-admin" onClick={() => change('admin')}>
            Change the admin PIN
          </Button>
          <Button data-testid="roles-change-operator" onClick={() => change('operator')}>
            Change the operator PIN
          </Button>
        </div>
        {role && (
          <form
            className="space-y-3 rounded-lg border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void window.drashti.roles.changePin({ role, pin }).then((result) => {
                if (result.ok) {
                  setDone(`The ${role} PIN is changed.`);
                  setRole(null);
                } else setProblem(result.message);
              });
            }}
          >
            <NewPin
              label={`New ${role} PIN`}
              pin={pin}
              again={again}
              onPin={setPin}
              onAgain={setAgain}
              testId="roles-new"
            />
            <div className="flex gap-2">
              <Button type="button" onClick={() => setRole(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!ready(pin, again)}
                data-testid="roles-save-pin"
              >
                Save
              </Button>
            </div>
            {problem && (
              <p role="alert" className="text-sm text-danger-fg">
                {problem}
              </p>
            )}
          </form>
        )}
        {done && <Notice tone="success">{done}</Notice>}
        {problem && !role && (
          <p role="alert" className="text-sm text-danger-fg">
            {problem}
          </p>
        )}
      </div>
      {turningOff && (
        <ConfirmDialog
          title="Turn roles off?"
          confirmLabel="Turn roles off"
          testId="roles-off-confirm"
          onCancel={() => setTurningOff(false)}
          onConfirm={() => {
            void window.drashti.roles.turnOff().then((result) => {
              setTurningOff(false);
              if (!result.ok) setProblem(result.message);
            });
          }}
        >
          Both PINs are forgotten. Anyone in Pro Mode can then change anything, and Simple Mode is left by
          typing “pro”, as before roles.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
