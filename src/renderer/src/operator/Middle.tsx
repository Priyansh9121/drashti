import { useEffect, useMemo, useState } from 'react';
import type { PresentationDoc } from '../../../shared/library';
import { playOrder } from '../../../shared/order';
import { useEngine } from '../engine/engine-store';
import { openSlideEditor } from '../editor/editor-store';
import { NewTimerSlideInLibrary } from '../editor/NewTimerSlide';
import { fileMenuProps } from '../files/FileMenu';
import { fileMenuEntries } from '../files/file-menu';
import { libraryPresentation, slideRowTarget } from '../files/targets';
import { useWhatIsThis } from '../help/WhatIsThis';
import { deleteOpenLabel, requestRemovalOfOpen } from '../library/import-store';
import { leaveItem, selectPresentation, useLibrary } from '../library/library-store';
import { OpenPlaylist } from '../playlists/OpenPlaylist';
import { usePlaylists } from '../playlists/playlist-store';
import { presentationRows } from '../playlists/rows';
import { SlideRow } from '../playlists/SlideRow';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import { MoreHorizontal, Presentation, RotateCcw, SquarePen, Timer, Trash2 } from '../ui/icons';
import { MenuButton } from '../ui/Menu';
import { CentredPlace, EmptyState, ErrorState, Loading } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { chooseArrangement, goLive } from './actions';
import { setJumpRows } from './jump';
import { StartHere } from './StartHere';

/*
 * The middle of the operator window (Session 55, Part 4: the playlist is where things go live). The bottom slides area
 * went: the open playlist has the whole middle, its presentations' slides as rows under their names. With no playlist
 * open, the library's chosen presentation shows as rows the same way, under its name, with its order, Edit slides and
 * its menu; with nothing chosen, the three steps to start.
 */

export function Middle({ platform }: { platform: string }) {
  const openId = usePlaylists((s) => s.openId);
  return (
    <main aria-label="Playlist and slides" className="flex min-h-0 flex-1 flex-col">
      {openId ? (
        <div className="flex min-h-0 flex-1 flex-col bg-panel" data-testid="centre-playlist">
          <OpenPlaylist platform={platform} />
        </div>
      ) : (
        <LibraryRows platform={platform} />
      )}
    </main>
  );
}

/** Choose the order the presentation plays in: one of its arrangements, or every slide. */
function ArrangementPicker({ doc }: { doc: PresentationDoc }) {
  if (doc.arrangements.length === 0) return null;
  return (
    <Field label="Arrangement" layout="inline">
      <Select
        data-testid="arrangement"
        className="max-w-48"
        value={doc.selectedArrangementId ?? ''}
        onChange={(e) => {
          void chooseArrangement(doc.id, e.target.value === '' ? null : e.target.value);
        }}
      >
        <option value="">All slides in order</option>
        {doc.arrangements.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * The chosen presentation's slides could not be read (Session 39): said, with Try again, never
 * "Opening the presentation…" for good. The screens keep what they show; the log says why.
 */
function PresentationUnread({ id }: { id: string }) {
  const name = useLibrary((s) => s.presentations.find((p) => p.id === id)?.name ?? null);
  const [trying, setTrying] = useState(false);
  return (
    <CentredPlace>
      <ErrorState
        title={name ? `Drashti couldn’t open “${name}”` : 'Drashti couldn’t open the presentation'}
        action={
          <Button
            variant="primary"
            icon={RotateCcw}
            disabled={trying}
            data-testid="presentation-try-again"
            onClick={() => {
              setTrying(true);
              void selectPresentation(id).finally(() => {
                setTrying(false);
              });
            }}
          >
            Try again
          </Button>
        }
      >
        The screens keep what they show. If Try again doesn’t open it, tell the admin.
      </ErrorState>
    </CentredPlace>
  );
}

/** The library's chosen presentation as rows (no playlist open). */
function LibraryRows({ platform }: { platform: string }) {
  const doc = useLibrary((s) => s.doc);
  const selectedId = useLibrary((s) => s.selectedId);
  const unreadId = useLibrary((s) => s.unreadId);
  if (!doc)
    return selectedId ? (
      unreadId === selectedId ? (
        <PresentationUnread id={selectedId} />
      ) : (
        <Loading label="Opening the presentation…" className="flex-1" />
      )
    ) : (
      <StartHere />
    );
  return <PresentationRows doc={doc} platform={platform} />;
}

function PresentationRows({ doc, platform }: { doc: PresentationDoc; platform: string }) {
  const selectedId = useLibrary((s) => s.selectedId);
  const focusSlideId = useLibrary((s) => s.focusSlideId);
  const summary = useLibrary((s) => s.presentations.find((p) => p.id === doc.id) ?? null);
  const live = useEngine((s) => s.state?.live);
  // A timer shown alone (Session 50) is in the slide's place but no slide of this presentation.
  const liveSlideId = useEngine((s) => {
    const shown = s.state?.layers.slide;
    return shown && !shown.timer ? shown.slide.id : null;
  });
  const order = useMemo(() => playOrder(doc, doc.selectedArrangementId), [doc]);
  const rows = useMemo(() => presentationRows(doc, doc.selectedArrangementId), [doc]);
  const help = useWhatIsThis('slides');
  // New Timer Slide… (Session 50): after which slide, while its dialog is open.
  const [timerSlide, setTimerSlide] = useState<{ slideId: string; position: number } | null>(null);
  const editable = !doc.passage && !doc.repeat;
  // Jump by number (Session 55): each row puts itself up as a click does.
  useEffect(() => {
    setJumpRows(
      rows.flatMap((r) =>
        r.kind === 'slide'
          ? [
              {
                number: r.number,
                go: () => {
                  leaveItem();
                  void goLive(doc.id, r.at.position, r.arrangementId, null);
                },
              },
            ]
          : [],
      ),
    );
    return () => {
      setJumpRows([]);
    };
  }, [rows, doc.id]);
  const liveHere = live?.presentationId === doc.id && liveSlideId !== null;
  // Delete… for this presentation alone, whatever else is marked in the library (Session 50).
  const deleteThis = {
    label: deleteOpenLabel(null),
    run: () => {
      void requestRemovalOfOpen(doc.id, doc.name);
    },
  };
  const found = order.slides.find((o) => o.slide.id === focusSlideId)?.position ?? -1;
  // Until the newly selected presentation arrives, the old slides cannot be clicked: a quick click must never put the
  // previous presentation's slide live.
  const stale = doc.id !== selectedId;
  return (
    <section
      aria-label={`Slides of ${doc.name}`}
      aria-busy={stale ? 'true' : undefined}
      inert={stale}
      className="flex min-h-0 flex-1 flex-col bg-panel transition-opacity"
      style={stale ? { opacity: 0.4 } : undefined}
      data-testid="slide-grid"
      data-presentation-id={doc.id}
    >
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2"
        data-strip=""
      >
        <Presentation size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <h2 className="min-w-40 flex-[1_1_10rem] text-base font-bold">
          <Truncate text={doc.name} />
        </h2>
        {help.button}
        {doc.passage ? (
          // A Shastra passage is made from its text: its words and slides are not edited here.
          <span className="text-xs text-muted" data-testid="passage-note">
            Shastra passage · drag it from Shastra onto a playlist to add it
          </span>
        ) : doc.repeat ? (
          // Repeat Slides (Session 26d): made from its playlist, changed there.
          <span className="text-xs text-muted" data-testid="repeat-note">
            Repeat Slides · a slide put up goes round from there
          </span>
        ) : (
          <ArrangementPicker doc={doc} />
        )}
        {editable && (
          <>
            <Button
              size="sm"
              icon={SquarePen}
              data-testid="edit-slides"
              // At the slide on the screens, or the one a search found.
              onClick={() => void openSlideEditor(doc.id, doc.name, liveHere ? liveSlideId : focusSlideId)}
            >
              Edit slides
            </Button>
            {/* Session 50: Delete… for the presentation open here, with Undo (Session 55: asked first only when it is
                up or in a playlist). Pro Mode only, as the whole middle is. */}
            {/* The one menu (Session 55, Part 14): Edit slides, Rename, Show in Finder, and Delete… for this one. */}
            <MenuButton
              label="Presentation"
              title="Presentation actions"
              icon={MoreHorizontal}
              testId="presentation-menu"
              entries={
                summary
                  ? fileMenuEntries({ ...libraryPresentation(summary), remove: deleteThis }, platform)
                  : [{ label: deleteThis.label, icon: Trash2, danger: true, onSelect: deleteThis.run }]
              }
            />
          </>
        )}
      </div>
      {/* Its words shrink and scroll in a short place (Session 51). */}
      {help.card && <div className="min-h-0 overflow-y-auto pt-2">{help.card}</div>}
      {rows.length === 0 ? (
        <CentredPlace>
          <EmptyState icon={Presentation} title="No slides yet">
            Use Edit slides to make its slides.
          </EmptyState>
        </CentredPlace>
      ) : (
        <ul
          data-testid="slide-list"
          aria-label={`Slides of ${doc.name}`}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pt-2 pb-6"
        >
          {rows.map((r) =>
            r.kind === 'slide' ? (
              <SlideRow
                key={r.key}
                number={r.number}
                label={r.label}
                line={r.line}
                at={r.at}
                firstOfRun={r.firstOfRun}
                found={r.at.position === found}
                live={
                  liveHere &&
                  (live.arrangementId === r.arrangementId
                    ? r.at.position === live.slideIndex
                    : r.at.slide.id === liveSlideId)
                }
                onClick={(e) => {
                  // One click puts it up (a double click's second does nothing more); Cmd, Ctrl, Alt and Shift never.
                  if (e.detail > 1 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                  leaveItem();
                  void goLive(doc.id, r.at.position, r.arrangementId, null);
                }}
                onDoubleClick={
                  editable ? () => void openSlideEditor(doc.id, doc.name, r.at.slide.id) : undefined
                }
                {...fileMenuProps(() =>
                  slideRowTarget(r, doc.name, null, [
                    ...(editable
                      ? [
                          {
                            label: 'New Timer Slide…',
                            icon: Timer,
                            onSelect: () => {
                              setTimerSlide({ slideId: r.at.slide.id, position: r.at.position });
                            },
                          },
                        ]
                      : []),
                  ]),
                )}
              />
            ) : null,
          )}
        </ul>
      )}
      {timerSlide && (
        <NewTimerSlideInLibrary
          presentationId={doc.id}
          name={doc.name}
          afterSlideId={timerSlide.slideId}
          position={timerSlide.position}
          onClose={() => {
            setTimerSlide(null);
          }}
        />
      )}
    </section>
  );
}
