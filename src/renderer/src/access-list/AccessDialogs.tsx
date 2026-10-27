import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ACCESS_NAME_MAX, ACCESS_NOTE_MAX, REVOKE_QUESTION } from '../../../shared/access-list';
import { gmailKey, gmailShaped } from '../../../shared/access-protocol';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Field, Textarea, TextInput } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import { addGmail, closeDialog, edit, saveNote, useAccessList } from './access-list-store';

/*
 * The Access List's dialogs (Session 54, E4): Add a Gmail (its request sent, and approved at once if the owner
 * ticks it: the person's token goes by email), a Gmail's note (only the owner sees it), and Revoke, which asks
 * first, Cancel focused, in the owner's words: their Drashti stops at once, screens and stream included.
 */

export function AddGmailDialog() {
  const busy = useAccessList((s) => s.busy);
  const problem = useAccessList((s) => s.dialogProblem);
  const [gmail, setGmail] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [approve, setApprove] = useState(true);
  const [tried, setTried] = useState(false);
  const shaped = gmailShaped(gmail);
  const add = () => {
    setTried(true);
    if (shaped && !busy) void addGmail({ gmail: gmail.trim(), name, note, approve });
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
