import type { EditSlide } from '../../../shared/slide-edit';
import { Button } from '../ui/Button';
import { commit, select, startEditing, useEditor } from './editor-store';
import { elementName, type SlideObject } from './objects';
import { arrange, mapElements } from './ops';
import { finishTextEditing } from './TextBoxEditor';

export function ObjectsPane({ slide }: { slide: EditSlide }) {
  const selection = useEditor((s) => s.selection);
  const elements: readonly SlideObject[] = slide.elements;
  const selected = new Set(selection);
  const canMove = (step: number) =>
    elements.some((el, index) => {
      const other = elements[index + step];
      return selected.has(el.id) && other && !selected.has(other.id);
    });
  const reorder = (how: 'forward' | 'backward') => {
    finishTextEditing();
    const now = useEditor.getState();
    if (now.doc && now.slideId === slide.id)
      commit(arrange(now.doc, slide.id, selection, how), { select: selection });
  };
  const toggleVisibility = (id: string) => {
    finishTextEditing();
    const now = useEditor.getState();
    if (!now.doc || now.slideId !== slide.id) return;
    commit(
      mapElements(now.doc, slide.id, [id], (el: SlideObject) => {
        if (!el.hidden) return { ...el, hidden: true };
        const { hidden: _hidden, ...shown } = el;
        return shown;
      }),
    );
  };
  return (
    <section
      aria-label="Objects"
      data-testid="editor-objects"
      className="space-y-2 border-b border-line px-3 py-3"
    >
      <h3 className="text-2xs font-bold tracking-wider text-heading uppercase">Objects</h3>
      {elements.length === 0 ? (
        <p className="text-xs text-muted">No objects on this slide.</p>
      ) : (
        <>
          <ol className="max-h-36 space-y-1 overflow-y-auto">
            {[...elements].reverse().map((el) => {
              const name = elementName(el);
              const visibility = el.hidden ? 'Show' : 'Hide';
              return (
                <li
                  key={el.id}
                  data-testid="editor-object"
                  data-object-id={el.id}
                  data-hidden={el.hidden ? 'true' : undefined}
                  className="flex min-w-0 gap-1"
                >
                  <Button
                    size="sm"
                    variant={selected.has(el.id) ? 'strong' : 'ghost'}
                    aria-pressed={selected.has(el.id)}
                    title={name}
                    data-testid="object-select"
                    className="min-w-0 flex-1 justify-start"
                    onClick={() => {
                      finishTextEditing();
                      select([el.id], { expandGroups: false });
                    }}
                    onDoubleClick={() => startEditing(el.id)}
                  >
                    <span className="truncate">{name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${visibility} ${name}`}
                    title={`${visibility} this object on the slide`}
                    onClick={() => toggleVisibility(el.id)}
                  >
                    {visibility}
                  </Button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              disabled={!canMove(1)}
              title="Move the selected objects one place closer to the front"
              onClick={() => reorder('forward')}
            >
              Bring forward
            </Button>
            <Button
              size="sm"
              disabled={!canMove(-1)}
              title="Move the selected objects one place closer to the back"
              onClick={() => reorder('backward')}
            >
              Send backward
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
