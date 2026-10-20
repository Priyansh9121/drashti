import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IDLE_WHEN_NAMES } from '../../../shared/idle';
import type { GroupLook, LookInfo } from '../../../shared/looks';
import { DEFAULT_GROUP_LOOK, groupLookIn, LOOK_LAYER_NAMES, LOOK_LAYERS } from '../../../shared/looks';
import type { Lang } from '../../../shared/model';
import { programPicture } from '../../../shared/program';
import type { ScreenGroupConfig } from '../../../shared/screens';
import type { DeviceChoice, StreamLayout, StreamStatus } from '../../../shared/stream';
import { LANG_NAMES } from '../../../shared/themes';
import { useEngine } from '../engine/engine-store';
import { StagePreview } from '../operator/StageControls';
import { ProgramView } from '../program/ProgramView';
import { PlacedInParent } from '../render/Placed';
import { Scene } from '../render/Scene';
import { SceneBoundary } from '../render/SceneBoundary';
import { openSetup } from '../setup/setup-store';
import {
  connectStageLayouts,
  openStageLayouts,
  STANDARD,
  useStageLayouts,
} from '../stage/stage-layouts-store';
import { LAYOUT_SHOWS, LayoutSwitch } from '../stream/LayoutSwitch';
import { usePreview } from '../stream/preview';
import { connectStream, openStreamPanel, streamAction, useStream } from '../stream/stream-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import type { Icon } from '../ui/icons';
import { Camera, LayoutTemplate, Monitor, Radio, Search, Settings, Tv, Wand2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { GroupLookSettings } from './LookSettings';
import { useScreens } from './screens-store';

/*
 * Screens' three cards (Session 26): the projector (the audience groups),
 * the stage screen and YouTube (the stream), each with a small preview, the
 * Look whose settings it shows and what it shows. The displays, the nodes
 * and the groups' own settings are below them.
 *
 * YouTube's card holds the stream's layout, camera and sound input and
 * languages: the same settings the Stream panel shows. Opening Screens
 * starts nothing: its preview is a still of what the stream would show,
 * drawn here, unless the stream is on air or recording (or the operator asks
 * for the camera and sound input lists, which the stream's page finds).
 */

const PREVIEW = 'relative aspect-video w-full overflow-hidden rounded-md border border-line-strong bg-black';
const CANVAS = { width: 1920, height: 1080 };

function Card({
  testId,
  icon: CardIcon,
  title,
  badge,
  preview,
  children,
  below,
}: {
  testId: string;
  icon: Icon;
  title: string;
  badge: ReactNode;
  preview: ReactNode;
  /** Beside the preview. */
  children: ReactNode;
  /** Under them both, the card's width. */
  below?: ReactNode;
}) {
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-panel-2 p-3 shadow-card"
      data-testid={testId}
      aria-labelledby={`${testId}-title`}
    >
      <div className="flex items-center gap-2">
        <CardIcon size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <h3 id={`${testId}-title`} className="min-w-0 flex-1 truncate text-base font-bold">
          {title}
        </h3>
        {badge}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {preview}
        <div className="min-w-0 space-y-2">{children}</div>
      </div>
      {below}
    </section>
  );
}

const languageWords = (languages: readonly Lang[] | null) =>
  languages ? languages.map((l) => LANG_NAMES[l]).join(', ') : 'every language';

/** A group's settings in a Look, in words. */
function shownWords(settings: GroupLook): string {
  const slides = settings.slides === 'lowerThird' ? 'The words as a lower third' : 'The slides as designed';
  const layers = LOOK_LAYERS.every((l) => settings.layers.includes(l))
    ? 'every layer'
    : settings.layers.length === 0
      ? 'no layers'
      : settings.layers.map((l) => LOOK_LAYER_NAMES[l].toLowerCase()).join(', ');
  return `${slides}, in ${languageWords(settings.languages)}; ${layers}. When nothing is up: ${IDLE_WHEN_NAMES[settings.idle].toLowerCase()}.`;
}

/** The Look whose settings a card shows (the live one unless another is chosen under Screen groups). */
function LookLine({ look }: { look: LookInfo }) {
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted" data-testid="card-look">
      In the Look “{look.name}”{look.id === liveId && <Badge tone="live">Live</Badge>}
    </p>
  );
}

/** How many of a group's screens show now. */
function useShowing(groups: readonly ScreenGroupConfig[]): Map<string, number> {
  const status = useScreens((s) => s.snapshot?.status);
  const showing = new Map<string, number>();
  for (const g of groups)
    showing.set(
      g.id,
      (status ?? []).filter((st) => st.state === 'showing' && g.screens.some((sc) => sc.id === st.screenId))
        .length,
    );
  return showing;
}

function ShowingBadge({ count }: { count: number }) {
  return (
    <Badge tone={count > 0 ? 'success' : 'neutral'} data-testid="card-showing">
      {count > 0 ? `${String(count)} showing` : 'Not showing'}
    </Badge>
  );
}

function GroupsLine({ groups, showing }: { groups: ScreenGroupConfig[]; showing: Map<string, number> }) {
  return (
    <ul className="space-y-0.5 text-xs text-muted" data-testid="card-groups">
      {groups.map((g) => {
        const n = g.screens.length;
        return (
          <li key={g.id}>
            {g.name}:{' '}
            {n === 0
              ? 'no display yet'
              : `${String(n)} screen${n === 1 ? '' : 's'}, ${String(showing.get(g.id) ?? 0)} showing`}
          </li>
        );
      })}
    </ul>
  );
}

function NotSetUp({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <>
      <p className="text-sm text-muted">{what}</p>
      <Button
        size="sm"
        icon={Wand2}
        onClick={() => {
          onClose();
          void openSetup(1);
        }}
      >
        Set Up Screens…
      </Button>
    </>
  );
}

/** What the first audience group shows now, small, as the operator window's LIVE preview draws it. */
function ProjectorPreview({ group }: { group: ScreenGroupConfig | null }) {
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const look = useEngine((s) => (group ? s.state?.look.groups[group.id] : undefined));
  const screen = group?.screens[0];
  const canvas = { width: screen?.canvasWidth ?? 1920, height: screen?.canvasHeight ?? 1080 };
  return (
    <div className={PREVIEW} data-testid="projector-preview" data-a11y-picture aria-hidden="true">
      {state && group && (
        <SceneBoundary resetKey={rev} fallbackClassName="absolute inset-0 bg-black">
          <PlacedInParent content={canvas} mode="fit" className="absolute inset-0">
            <Scene
              state={state}
              canvas={canvas}
              scaling={screen?.scaling ?? 'fit'}
              {...(look ? { look } : {})}
            />
          </PlacedInParent>
        </SceneBoundary>
      )}
    </div>
  );
}

function ProjectorCard({
  groups,
  look,
  toGroup,
  onClose,
}: {
  groups: ScreenGroupConfig[];
  look: LookInfo | null;
  toGroup: (id: string) => void;
  onClose: () => void;
}) {
  const showing = useShowing(groups);
  const first = groups[0] ?? null;
  const settings = first && look ? (look.groups[first.id] ?? DEFAULT_GROUP_LOOK) : null;
  return (
    <Card
      testId="screens-card-projector"
      icon={Monitor}
      title="Projector"
      badge={<ShowingBadge count={[...showing.values()].reduce((a, b) => a + b, 0)} />}
      preview={<ProjectorPreview group={first} />}
    >
      {first && look && settings ? (
        <>
          <LookLine look={look} />
          <p className="text-sm" data-testid="card-shows">
            {shownWords(settings)}
          </p>
          <GroupsLine groups={groups} showing={showing} />
          <Button
            size="sm"
            icon={Settings}
            data-testid="card-settings"
            onClick={() => {
              toGroup(first.id);
            }}
          >
            Change what it shows
          </Button>
        </>
      ) : (
        <NotSetUp
          what="No projector is set up yet: Set Up Screens… gives a display to it."
          onClose={onClose}
        />
      )}
    </Card>
  );
}

function StageCard({
  groups,
  look,
  toGroup,
  onClose,
}: {
  groups: ScreenGroupConfig[];
  look: LookInfo | null;
  toGroup: (id: string) => void;
  onClose: () => void;
}) {
  const showing = useShowing(groups);
  const layouts = useStageLayouts((s) => s.layouts);
  const first = groups[0] ?? null;
  const settings = first && look ? (look.groups[first.id] ?? DEFAULT_GROUP_LOOK) : null;
  const layoutName =
    (settings?.stageLayoutId ? layouts?.find((l) => l.id === settings.stageLayoutId)?.name : null) ??
    'Standard';
  return (
    <Card
      testId="screens-card-stage"
      icon={Tv}
      title="Stage screen"
      badge={<ShowingBadge count={[...showing.values()].reduce((a, b) => a + b, 0)} />}
      preview={first ? <StagePreview className="w-full" /> : <div className={PREVIEW} aria-hidden="true" />}
    >
      {first && look && settings ? (
        <>
          <LookLine look={look} />
          <p className="text-sm" data-testid="card-shows">
            The performers’ view in the {layoutName === 'Standard' ? 'Standard' : `“${layoutName}”`} stage
            layout, in {languageWords(settings.languages)}. The audience never sees it.
          </p>
          <GroupsLine groups={groups} showing={showing} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={LayoutTemplate}
              data-testid="card-edit-stage-layout"
              onClick={() => {
                openStageLayouts(settings.stageLayoutId ?? STANDARD);
              }}
            >
              Edit layout…
            </Button>
            <Button
              size="sm"
              icon={Settings}
              data-testid="card-settings"
              onClick={() => {
                toGroup(first.id);
              }}
            >
              Change what it shows
            </Button>
          </div>
        </>
      ) : (
        <NotSetUp
          what="No stage screen is set up yet: Set Up Screens… gives a display to it."
          onClose={onClose}
        />
      )}
    </Card>
  );
}

/** The stream's picture as it goes out (while it runs): the stream's page's preview frames. */
function LiveProgram() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const preview = usePreview(canvas);
  return (
    <div className={PREVIEW} data-testid="youtube-preview" data-kind="live" data-a11y-picture>
      <canvas
        ref={canvas}
        role="img"
        aria-label="What the stream shows now"
        className="h-full w-full object-contain"
      />
      {!preview.hasFrame && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loading label="Starting the stream’s picture…" immediate />
        </div>
      )}
    </div>
  );
}

/** What the stream would show now, drawn here (nothing is started for it), the camera's place marked. */
function StillProgram({ groupId, layout }: { groupId: string | null; layout: StreamLayout }) {
  const state = useEngine((s) => s.state);
  const rev = useEngine((s) => s.rev);
  const streamLook = groupLookIn(state?.look, groupId);
  const languages = streamLook.languages;
  const picture = state ? programPicture(state, layout, languages) : null;
  return (
    <div
      className={PREVIEW}
      data-testid="youtube-preview"
      data-kind="still"
      data-a11y-picture
      aria-hidden="true"
    >
      {state && (
        <SceneBoundary resetKey={rev} fallbackClassName="absolute inset-0 bg-black">
          <PlacedInParent content={CANVAS} mode="fit" className="absolute inset-0">
            <ProgramView
              state={state}
              layout={layout}
              languages={languages}
              movement={streamLook.movement}
              canvas={CANVAS}
              camera={null}
            />
          </PlacedInParent>
        </SceneBoundary>
      )}
      {picture?.kind === 'camera' && !picture.full && (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-1 text-xs text-faint">
          <Camera size={20} aria-hidden="true" />
          The camera
        </div>
      )}
    </div>
  );
}

function InputSelect({
  label,
  value,
  devices,
  listed,
  none,
  testId,
  onChange,
}: {
  label: string;
  value: DeviceChoice | null;
  devices: DeviceChoice[];
  /** The stream's page has listed what is connected (else only the one chosen is known). */
  listed: boolean;
  none: string;
  testId: string;
  onChange: (d: DeviceChoice | null) => void;
}) {
  const all = value && !devices.some((d) => d.id === value.id) ? [...devices, value] : devices;
  return (
    <Field label={label} className="min-w-0 flex-1">
      <Select
        value={value?.id ?? ''}
        data-testid={testId}
        onChange={(e) => {
          onChange(all.find((d) => d.id === e.target.value) ?? null);
        }}
      >
        <option value="">{none}</option>
        {all.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {!listed || devices.some((x) => x.id === d.id) ? '' : ' (not connected)'}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function StreamInputs({
  status,
  asked,
  onFind,
}: {
  status: StreamStatus;
  asked: boolean;
  onFind: () => void;
}) {
  const listed = status.programOn;
  const save = (camera: DeviceChoice | null, sound: DeviceChoice | null) =>
    void streamAction(() => window.drashti.stream.setInputs(camera, sound));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <InputSelect
          label="Camera (or capture card)"
          value={status.chosen.camera}
          devices={status.inputs.cameras}
          listed={listed}
          none="No camera"
          testId="screens-stream-camera"
          onChange={(camera) => {
            save(camera, status.chosen.sound);
          }}
        />
        <InputSelect
          label="Sound input (the mixer’s line in)"
          value={status.chosen.sound}
          devices={status.inputs.microphones}
          listed={listed}
          none="No sound input"
          testId="screens-stream-sound"
          onChange={(sound) => {
            save(status.chosen.camera, sound);
          }}
        />
      </div>
      {!listed &&
        (asked ? (
          <Loading label="Looking for cameras and sound inputs…" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Search} data-testid="youtube-find-inputs" onClick={onFind}>
              Find cameras and sound inputs
            </Button>
            <span className="text-xs text-muted">
              The stream’s picture starts for it, with the camera, while Screens is open. Nothing goes on air.
            </span>
          </div>
        ))}
      {status.inputs.message && <p className="text-xs text-warning-fg">{status.inputs.message}</p>}
    </div>
  );
}

function YouTubeCard({
  group,
  look,
  onClose,
}: {
  group: ScreenGroupConfig | null;
  look: LookInfo | null;
  onClose: () => void;
}) {
  const status = useStream((s) => s.status);
  const error = useStream((s) => s.error);
  // The camera and sound input lists were asked for: the stream's page runs for them while the card is open.
  const [asked, setAsked] = useState(false);
  const inUse = status ? status.live.state !== 'off' || status.recording.state !== 'off' : false;
  const layout = status?.layout ?? 'camera';
  const badge =
    status?.live.state === 'live' || status?.live.state === 'reconnecting' ? (
      <Badge tone="live">On air</Badge>
    ) : status?.recording.state === 'recording' ? (
      <Badge tone="live">Recording</Badge>
    ) : (
      <Badge>Off air</Badge>
    );
  return (
    <Card
      testId="screens-card-youtube"
      icon={Radio}
      title="YouTube (the stream)"
      badge={badge}
      preview={
        inUse || asked ? <LiveProgram /> : <StillProgram groupId={group?.id ?? null} layout={layout} />
      }
      below={
        <>
          {status && (
            <StreamInputs
              status={status}
              asked={asked}
              onFind={() => {
                setAsked(true);
              }}
            />
          )}
          {look && group && <GroupLookSettings look={look} groupId={group.id} role="stream" />}
          {error && (
            <Notice tone="danger" onDismiss={() => useStream.setState({ error: null })}>
              {error}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={Settings}
              data-testid="youtube-open-stream"
              onClick={() => {
                onClose();
                openStreamPanel();
              }}
            >
              Stream panel
            </Button>
            <span className="text-xs text-muted">The stream key, profiles, Go Live and recording.</span>
          </div>
        </>
      }
    >
      {status ? (
        <>
          <LayoutSwitch layout={layout} testId="youtube-layout" />
          <p className="text-xs text-muted" data-testid="youtube-shows">
            {LAYOUT_SHOWS[layout]}
          </p>
        </>
      ) : (
        <Loading />
      )}
      {group && (
        <p className="text-xs text-faint">
          Drawn off screen, it needs no display. Its screen group: {group.name}.
        </p>
      )}
    </Card>
  );
}

/** The three cards, at the top of Screens. `look`: the Look whose settings they show. */
export function ScreenCards({ look, onClose }: { look: LookInfo | null; onClose: () => void }) {
  const groups = useScreens((s) => s.snapshot?.groups);
  useEffect(() => {
    connectStream();
    connectStageLayouts();
  }, []);
  if (!groups) return null;
  // A group's own settings, under Screen groups below.
  const toGroup = (id: string) => {
    const card = document.getElementById(`screen-group-${id}`);
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  };
  return (
    <section className="space-y-3" data-testid="screens-cards" aria-label="The screens">
      <ProjectorCard
        groups={groups.filter((g) => g.role === 'audience')}
        look={look}
        toGroup={toGroup}
        onClose={onClose}
      />
      <StageCard
        groups={groups.filter((g) => g.role === 'stage')}
        look={look}
        toGroup={toGroup}
        onClose={onClose}
      />
      <YouTubeCard group={groups.find((g) => g.role === 'stream') ?? null} look={look} onClose={onClose} />
    </section>
  );
}
