import { useEffect, useRef } from 'react';
import { lowerThirdName, shownLines, WHERE_NAMES } from '../../../shared/lower-thirds';
import { useEngine } from '../engine/engine-store';
import { clickedMany } from '../music/music-store';
import { isRemoveKey } from '../playlists/playlist-shared';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { Captions, Pencil, Plus, Trash2 } from '../ui/icons';
import { rowClass } from '../ui/ListRow';
import { Panel } from '../ui/Panel';
import { BoxOverlay, boxChoice, ChosenBar, isSelectAll, rowsTouching, useBoxSelect } from '../ui/select-many';
import { Truncate } from '../ui/Truncate';
import {
  connectLowerThirds,
  deleteLowerThirds,
  editLowerThird,
  showOrHide,
  useLowerThirds,
} from './lower-thirds-store';

/*
 * Lower Thirds (Session 44), in More tools in Macros' place: each lower third a row with its first lines and where
 * it shows, and one button that shows it and hides it again (a show control: it changes the screens at once,
 * and says it is up in LIVE's colour). New… and Edit open the editor; several can be chosen together (a box
 * dragged over them, Shift and Cmd or Ctrl clicks, Cmd or Ctrl-A) and deleted at once, with one Undo.
 */
export function LowerThirdsPanel({ platform, nested = false }: { platform: string; nested?: boolean }) {
  const list = useLowerThirds((s) => s.list);
  const marked = useLowerThirds((s) => s.marked);
  const upId = useEngine((s) => s.state?.layers.lowerThird?.id ?? null);
  useEffect(() => {
    connectLowerThirds();
  }, []);
  const listRef = useRef<HTMLUListElement>(null);
  const boxBase = useRef<string[]>([]);
  const box = useBoxSelect({
    list: listRef,
    hits: (b) => (listRef.current ? rowsTouching(listRef.current, b) : []),
    begin: () => {
      boxBase.current = useLowerThirds.getState().marked;
    },
    onBox: (ids, adding) => {
      const chosen = boxChoice(boxBase.current, ids, adding);
      useLowerThirds.setState({ marked: chosen, anchor: chosen[0] ?? null });
    },
    onClear: () => {
      useLowerThirds.setState({ marked: [], anchor: null });
    },
  });
  const items = list ?? [];
  const many = marked.length > 1;
  /** Delete for this row: the chosen ones together when it is one of them. */
  const deleting = (id: string) => (many && marked.includes(id) ? marked : [id]);
  return (
    <Panel
      nested={nested}
      help="lowerthirds"
      title="Lower Thirds"
      icon={Captions}
      collapsible
      remember="lower-thirds"
      bodyClassName="space-y-2 px-3 pb-3"
      data-testid="lower-thirds-panel"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          data-testid="lower-third-new"
          onClick={() => {
            editLowerThird(null);
          }}
        >
          New…
        </Button>
      }
    >
      {items.length === 0 ? (
        <p className="text-xs text-muted">
          No lower thirds yet. <strong>New…</strong> makes one: up to three lines (a name, a title and a
          place), how it looks, where it shows and how it comes in.
        </p>
      ) : (
        <>
          <ChosenBar
            count={marked.length}
            noun="lower thirds"
            onDelete={() => {
              void deleteLowerThirds(marked);
            }}
            onClear={() => {
              useLowerThirds.setState({ marked: [], anchor: null });
            }}
          />
          <ul
            ref={listRef}
            tabIndex={-1}
            aria-label="Lower thirds"
            data-testid="lower-thirds"
            className="relative max-h-64 space-y-1 overflow-y-auto focus:outline-none"
            onPointerDown={box.onPointerDown}
            onKeyDown={(e) => {
              if (!isSelectAll(e, platform)) return;
              e.preventDefault();
              const ids = items.map((l) => l.id);
              useLowerThirds.setState({ marked: ids, anchor: ids[0] ?? null });
            }}
          >
            <BoxOverlay box={box.box} as="li" />
            {items.map((lt) => {
              const name = lowerThirdName(lt.lines);
              const rest = shownLines(lt.lines).slice(1).join(' · ');
              const up = lt.id === upId;
              const chosen = marked.includes(lt.id);
              return (
                <li
                  key={lt.id}
                  className="flex items-center gap-1.5"
                  data-select-id={lt.id}
                  data-testid="lower-third-row"
                  data-id={lt.id}
                  data-up={up ? 'true' : undefined}
                  data-marked={chosen ? 'true' : undefined}
                >
                  <button
                    type="button"
                    aria-pressed={many ? chosen : undefined}
                    className={cx(
                      rowClass({ selected: chosen && !many, marked: many && chosen }),
                      'flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-1.5 text-left',
                    )}
                    onClick={(e) => {
                      const mods = {
                        toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey,
                        range: e.shiftKey,
                      };
                      const s = useLowerThirds.getState();
                      if (mods.toggle || mods.range) {
                        const next = clickedMany(
                          items.map((x) => x.id),
                          s.marked,
                          s.anchor,
                          lt.id,
                          mods,
                        );
                        useLowerThirds.setState({ marked: next.marked, anchor: next.anchor });
                        return;
                      }
                      useLowerThirds.setState({ marked: [lt.id], anchor: lt.id });
                    }}
                    onDoubleClick={() => {
                      editLowerThird(lt);
                    }}
                    onKeyDown={(e) => {
                      if (!isRemoveKey(e, platform)) return;
                      e.preventDefault();
                      void deleteLowerThirds(deleting(lt.id));
                    }}
                  >
                    <Truncate text={name} className="w-full text-sm font-medium text-fg" />
                    <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted">
                      <span className="shrink-0">{WHERE_NAMES[lt.where]}</span>
                      {rest && <Truncate text={`· ${rest}`} className="min-w-0" />}
                    </span>
                  </button>
                  <Button
                    variant={up ? 'live' : 'secondary'}
                    size="sm"
                    instant
                    data-testid="lower-third-show"
                    aria-label={up ? `Hide “${name}”` : `Show “${name}”`}
                    onClick={() => void showOrHide(lt, up)}
                  >
                    {up ? 'Hide' : 'Show'}
                  </Button>
                  <IconButton
                    icon={Pencil}
                    label={`Edit “${name}”`}
                    size="sm"
                    data-testid="lower-third-edit"
                    onClick={() => {
                      editLowerThird(lt);
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete “${name}”`}
                    size="sm"
                    data-testid="lower-third-delete"
                    onClick={() => void deleteLowerThirds(deleting(lt.id))}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
