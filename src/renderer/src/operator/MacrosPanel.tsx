import { useEffect, useState } from 'react';
import { MidiDialog } from '../midi/MidiDialog';
import { connectMacros, openMacros, runMacro, useMacros } from '../macros/macros-store';
import { Button } from '../ui/Button';
import { Clock, KeyboardMusic, Pencil, Zap } from '../ui/icons';
import { Panel } from '../ui/Panel';

/*
 * Macros: one button each, in its colour; a click runs its actions in order
 * as one change. Pro Mode only (Simple Mode runs no macros). Edit opens the
 * macro editor.
 */
export function MacrosPanel() {
  const macros = useMacros((s) => s.macros);
  const [midi, setMidi] = useState(false);
  useEffect(() => {
    connectMacros();
  }, []);
  return (
    <Panel
      title="Macros"
      icon={Zap}
      collapsible
      remember="macros"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="macros-panel"
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={KeyboardMusic}
            data-testid="open-midi"
            onClick={() => {
              setMidi(true);
            }}
          >
            MIDI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            onClick={() => {
              openMacros();
            }}
          >
            Edit
          </Button>
        </>
      }
    >
      {midi && (
        <MidiDialog
          onClose={() => {
            setMidi(false);
          }}
        />
      )}
      {macros && macros.length > 0 ? (
        <div role="group" aria-label="Run a macro" className="grid grid-cols-2 gap-1.5">
          {macros.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid="macro-button"
              data-macro={m.id}
              onClick={() => void runMacro(m.id)}
              className="flex min-h-9 items-center gap-2 rounded-lg border border-line-strong bg-panel-2 px-2 text-left text-sm font-medium text-fg hover:bg-panel-3"
            >
              <span
                aria-hidden="true"
                className="h-full w-1.5 shrink-0 self-stretch rounded-sm"
                style={{ background: m.color }}
              />
              <span className="min-w-0 flex-1 truncate py-1.5">{m.name}</span>
              {m.schedules.some((s) => s.enabled) && (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-xs text-muted"
                  title={`Runs by itself at ${m.schedules
                    .filter((s) => s.enabled)
                    .map((s) => s.time)
                    .join(', ')}`}
                >
                  <Clock size={12} aria-hidden="true" />
                  <span className="sr-only">Runs by itself at </span>
                  {m.schedules.find((s) => s.enabled)?.time}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">
          No macros yet. <strong>Edit</strong> makes one: several actions (a Look, clears, a prop, a message,
          a sound, black-out…) at one press.
        </p>
      )}
    </Panel>
  );
}
