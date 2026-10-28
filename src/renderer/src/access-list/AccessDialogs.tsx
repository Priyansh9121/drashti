import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  ACCESS_NAME_MAX,
  ACCESS_NOTE_MAX,
  endsCell,
  LENGTH_CHOICES,
  LENGTH_MAX_DAYS,
  REVOKE_QUESTION,
  typedDays,
} from '../../../shared/access-list';
import { ACCESS_UNLIMITED, gmailKey, gmailShaped, type AccessLength } from '../../../shared/access-protocol';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, NumberInput, Select, Textarea, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import {
  addGmail,
  closeDialog,
  edit,
  giveLength,
  saveNote,
  useAccessList,
  type LengthEdit,
} from './access-list-store';

/*
 * The Access List's dialogs (Session 54, E4): Add a Gmail (its request sent, and approved at once if the owner
 * ticks it: the person's token goes by email), a Gmail's note (only the owner sees it), and Revoke, which asks
 * first, Cancel focused, in the owner's words: their Drashti stops at once, screens and stream included. Approve,
 * Give access again and Change the length ask how long access lasts (the owner's decision of 28 Oct 2026), as Add
 * does: Unlimited chosen at first, so nobody is cut off by a slip; a length counts from when it is given.
 */

/** The length chosen in a dialog: one of LENGTH_CHOICES (by its value as text), or days typed. */
function useLengthChoice(initial: AccessLength) {
  const preset = LENGTH_CHOICES.some((c) => c.length === initial);
  const [choice, setChoice] = useState(preset ? String(initial) : 'typed');
  const [typed, setTyped] = useState(preset ? '' : String(initial));
  const length: AccessLength | null =
    choice === 'typed' ? typedDays(typed) : choice === ACCESS_UNLIMITED ? ACCESS_UNLIMITED : Number(choice);
  return { choice, setChoice, typed, setTyped, length };
}

/** How long access lasts: the choices, and the days typed when that is chosen (said wrong once tried). */
function LengthField({
  state,
  tried,
  disabled,
  hint,
}: {
  state: ReturnType<typeof useLengthChoice>;
  tried: boolean;
  disabled: boolean;
  hint: string;
}) {
  const wrong = tried && state.length === null;
  return (
    <div className="space-y-2">
      <Field label="How long may they use Drashti?" hint={hint}>
        <Select
          value={state.choice}
          disabled={disabled}
          data-testid="access-length-choice"
          onChange={(e) => {
            state.setChoice(e.target.value);
          }}
        >
          {LENGTH_CHOICES.map((c) => (
            <option key={String(c.length)} value={String(c.length)}>
              {c.label}
            </option>
          ))}
          <option value="typed">A number of days…</option>
        </Select>
      </Field>
      {state.choice === 'typed' && (
        <Field
          label="Number of days"
          error={wrong ? `A whole number of days from 1 to ${String(LENGTH_MAX_DAYS)}.` : null}
        >
          <NumberInput
            autoFocus
            min={1}
            max={LENGTH_MAX_DAYS}
            step={1}
            unit="days"
            value={state.typed}
            disabled={disabled}
            data-testid="access-length-days"
            onChange={(e) => {
              state.setTyped(e.target.value);
            }}
          />
        </Field>
      )}
    </div>
  );
}

const LENGTH_WORDS: Record<LengthEdit, { title: (gmail: string) => string; button: string; about: string }> =
  {
    approve: {
      title: (gmail) => `Approve ${gmail}`,
      button: 'Approve',
      about: 'Their one-time token goes to them by email.',
    },
    regrant: {
      title: (gmail) => `Give ${gmail} access again`,
      button: 'Give access again',
      about:
        'A new one-time token goes to them by email; a token sent before and not used stops working. Their computers already in stay in, for this length.',
    },
    length: {
      title: (gmail) => `Change the length for ${gmail}`,
      button: 'Change the length',
      about: 'Their Drashti hears it at its next check, within 15 seconds.',
    },
  };

/** Approve, Give access again or Change the length: how long access lasts, counted from now. */
export function LengthDialog({ kind, gmail }: { kind: LengthEdit; gmail: string }) {
  const busy = useAccessList((s) => s.busy);
  const problem = useAccessList((s) => s.dialogProblem);
  const view = useAccessList((s) => s.view);
  const person = view?.people?.find((p) => gmailKey(p.gmail) === gmailKey(gmail)) ?? null;
  // Unlimited at first; approving a Gmail the owner added, the length chosen then.
  const state = useLengthChoice(
    kind === 'approve' && person?.length !== null && person?.length !== undefined
      ? person.length
      : ACCESS_UNLIMITED,
  );
  const [tried, setTried] = useState(false);
  const words = LENGTH_WORDS[kind];
  const now = person && kind === 'length' ? endsCell(person, view?.listTime ?? null) : null;
  const save = () => {
    setTried(true);
    if (state.length !== null && !busy) void giveLength(kind, gmail, state.length);
  };
  return (
    <Dialog
      title={words.title(gmail)}
      size="sm"
      onClose={busy ? null : closeDialog}
      testId="access-length-dialog"
      bodyClassName="space-y-3"
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy} data-testid="access-length-save">
            {words.button}
          </Button>
        </>
      }
    >
      <p className="text-sm">{words.about}</p>
      {now && (
        <p className="text-sm text-muted" data-testid="access-length-now">
          {`Now: ${now.text}${now.detail ? ` (${now.detail})` : ''}`}
        </p>
      )}
      <LengthField
        state={state}
        tried={tried}
        disabled={busy}
        hint="Counted from now. Unlimited lasts until you revoke it. When a length ends, their Drashti stops until you give more time."
      />
      {busy && (
        <p role="status" className="text-xs text-muted">
          Asking the access list…
        </p>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}

export function AddGmailDialog() {
  const busy = useAccessList((s) => s.busy);
  const problem = useAccessList((s) => s.dialogProblem);
  const [gmail, setGmail] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [approve, setApprove] = useState(true);
  const [tried, setTried] = useState(false);
  const length = useLengthChoice(ACCESS_UNLIMITED);
  const shaped = gmailShaped(gmail);
  const add = () => {
    setTried(true);
    if (shaped && length.length !== null && !busy)
      void addGmail({ gmail: gmail.trim(), name, note, approve, length: length.length });
  };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };
  return (
    <Dialog
      title="Add a Gmail"
      size="sm"
      onClose={busy ? null : closeDialog}
      testId="access-add-dialog"
      bodyClassName="space-y-3"
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={add} disabled={busy} data-testid="access-add-save">
            {approve ? 'Add and approve' : 'Add'}
          </Button>
        </>
      }
    >
      <Field
        label="Gmail"
        error={tried && !shaped ? 'That does not look like an email address: check it.' : null}
      >
        <TextInput
          autoFocus
          value={gmail}
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={254}
          placeholder="Their Gmail address"
          data-testid="access-add-gmail"
          onChange={(e) => {
            setGmail(e.target.value);
          }}
          onKeyDown={onEnter}
        />
      </Field>
      <Field label="Name" hint="As you know them; they may give one when they ask.">
        <TextInput
          value={name}
          maxLength={ACCESS_NAME_MAX}
          data-testid="access-add-name"
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={onEnter}
        />
      </Field>
      <Field label="Note" hint="Only you see it: here, and in the Sheet.">
        <Textarea
          rows={2}
          value={note}
          maxLength={ACCESS_NOTE_MAX}
          data-testid="access-add-note"
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </Field>
      <Checkbox
        label="Approve it now: their token goes to them by email"
        checked={approve}
        data-testid="access-add-approve"
        onChange={(e) => {
          setApprove(e.target.checked);
        }}
      />
      <LengthField
        state={length}
        tried={tried}
        disabled={busy}
        hint="Counted from when it is approved. Unlimited lasts until you revoke it."
      />
      {busy && (
        <p role="status" className="text-xs text-muted">
          Asking the access list…
        </p>
      )}
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}

export function NoteDialog({ gmail }: { gmail: string }) {
  const busy = useAccessList((s) => s.busy);
  const problem = useAccessList((s) => s.dialogProblem);
  const people = useAccessList((s) => s.view?.people ?? null);
  const [text, setText] = useState(
    () => people?.find((p) => gmailKey(p.gmail) === gmailKey(gmail))?.note ?? '',
  );
  const save = () => {
    if (!busy) void saveNote(gmail, text);
  };
  return (
    <Dialog
      title={`Note for ${gmail}`}
      size="sm"
      onClose={busy ? null : closeDialog}
      testId="access-note-dialog"
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy} data-testid="access-note-save">
            Save note
          </Button>
        </>
      }
    >
      <Field label="Note" hint="Only you see it: here, and in the Sheet. Leave it empty to clear it.">
        <Textarea
          autoFocus
          rows={4}
          value={text}
          maxLength={ACCESS_NOTE_MAX}
          className="w-full"
          data-testid="access-note-text"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </Field>
      {busy && (
        <p role="status" className="mt-2 text-xs text-muted">
          Asking the access list…
        </p>
      )}
      {problem && (
        <Notice tone="danger" className="mt-2">
          {problem}
        </Notice>
      )}
    </Dialog>
  );
}

/** Revoke, asked first: Cancel has the focus, so Enter or Esc never revokes. */
export function RevokeDialog({ gmail, done }: { gmail: string; done: () => void }) {
  return (
    <ConfirmDialog
      title={REVOKE_QUESTION.title(gmail)}
      confirmLabel={REVOKE_QUESTION.confirm}
      testId="access-revoke-question"
      onCancel={closeDialog}
      onConfirm={() => {
        closeDialog();
        void edit('revoke', gmail).then(done);
      }}
    >
      <p className="font-medium text-fg">{REVOKE_QUESTION.body}</p>
      <p>{REVOKE_QUESTION.more}</p>
    </ConfirmDialog>
  );
}
