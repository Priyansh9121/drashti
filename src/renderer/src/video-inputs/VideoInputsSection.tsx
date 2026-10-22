import { useId, useState } from 'react';
import type { VideoInput } from '../../../shared/video-inputs';
import { useEngine } from '../engine/engine-store';
import { LiveBadge } from '../ui/Badge';
import { ConfirmDialog } from '../ui/Dialog';
import { Pencil } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { Notice } from '../ui/Notice';
import { RowAction, RowDelete } from '../ui/RowDelete';
import { Truncate } from '../ui/Truncate';
import { InputPicture, useSmallPicture } from './InputPicture';
import { openChangeInput, removeInput, showInput, useVideoInputs } from './video-inputs-store';
import { inputRowNote } from './words';

/*
 * Media's Video inputs (Session 50): this computer's named inputs, above the library's files, each with its own
 * small live picture. One click puts it up on the screens as the live background (the slide stays over it);
 * Change and Delete sit at the end of the row, as on the library's other rows (shown on the chosen row and the
 * row under the mouse). Only while there are any: Add a Video Input… names the first.
 */

function InputRow({
  input,
  live,
  chosen,
  onChoose,
  onRemove,
}: {
  input: VideoInput;
  live: boolean;
  /** Its Change and Delete show, and are in the Tab order. */
  chosen: boolean;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const capture = useSmallPicture(input.device);
  return (
    <li
      className={`${rowClass({ selected: live })} group relative flex h-14 items-center`}
      data-testid="video-input-row"
      data-name={input.name}
      data-live={live ? 'true' : undefined}
    >
      {/* Room at the end for Change and Delete, shown or not, so the row never changes as they show. */}
      <button
        type="button"
        data-testid="video-input-show"
        title={`Put “${input.name}” on the screens`}
        onFocus={onChoose}
        onClick={() => {
          onChoose();
          void showInput(input.id);
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pr-[4.5rem] pl-1.5 text-left"
      >
        <InputPicture capture={capture} className="w-16 shrink-0" />
        <span className="min-w-0 flex-1">
          <Truncate text={input.name} className="text-sm" />
          <span className="block truncate text-xs text-muted" data-testid="video-input-note">
            {inputRowNote(capture, input.fit)}
          </span>
        </span>
        {live && <LiveBadge />}
      </button>
      <RowAction
        icon={Pencil}
        label={`Change “${input.name}”`}
        chosen={chosen}
        onPress={() => {
          openChangeInput(input);
        }}
        className="absolute top-3.5 right-9"
        testId="video-input-change"
      />
      <RowDelete
        label={`Delete “${input.name}”`}
        chosen={chosen}
        onDelete={onRemove}
        className="absolute top-3.5 right-1.5"
      />
    </li>
  );
}

export function VideoInputsSection() {
  const inputs = useVideoInputs((s) => s.inputs);
  const upId = useEngine((s) =>
    s.state?.layers.background?.kind === 'input' ? s.state.layers.background.inputId : null,
  );
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<VideoInput | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const titleId = useId();
  if (inputs.length === 0) return null;
  return (
    // A group, not a landmark: the window's regions stay as they are (docs/design.md, "Landmarks").
    <div
      role="group"
      aria-labelledby={titleId}
      className="shrink-0 border-b border-line pb-2"
      data-testid="video-inputs"
    >
      <h3 id={titleId} className="px-3 pt-2 pb-1 text-xs font-bold text-muted">
        Video inputs
      </h3>
      <ul className="space-y-1 px-2">
        {inputs.map((input) => (
          <InputRow
            key={input.id}
            input={input}
            live={input.id === upId}
            chosen={input.id === chosenId || input.id === upId}
            onChoose={() => {
              setChosenId(input.id);
            }}
            onRemove={() => {
              setRemoving(input);
            }}
          />
        ))}
      </ul>
      {problem && (
        <Notice
          tone="warning"
          compact
          className="mx-3 mt-2"
          onDismiss={() => {
            setProblem(null);
          }}
        >
          {problem}
        </Notice>
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete the video input “${removing.name}”?`}
          confirmLabel="Delete"
          testId="video-input-remove"
          onCancel={() => {
            setRemoving(null);
          }}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void removeInput(id).then(setProblem);
          }}
        >
          <p>
            It goes from Media on this computer. The camera or capture input itself is not changed: Add a
            Video Input… can name it again.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
