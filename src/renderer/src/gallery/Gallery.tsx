import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, LiveBadge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import type { ButtonSize, ButtonVariant } from '../ui/Button';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { ColorInput, Field, NumberInput, Select, Slider, Textarea, TextInput } from '../ui/Field';
import {
  Ban,
  Eraser,
  FolderPlus,
  Image,
  Import,
  ListMusic,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  SkipBack,
  SkipForward,
  Stamp,
  Trash2,
  X,
} from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import { ListRow } from '../ui/ListRow';
import { Menu, MenuButton, menuPlace } from '../ui/Menu';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { Panel, SectionTitle } from '../ui/Panel';
import { Progress } from '../ui/Progress';
import { Splitter } from '../ui/Splitter';
import { EmptyState, ErrorState, Loading } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { Checkbox, Toggle } from '../ui/Toggle';
import { Tooltip } from '../ui/Tooltip';
import { Truncate } from '../ui/Truncate';

/* Placeholder words only: never real kirtan or scripture text. */
const NAMES = {
  en: 'Placeholder Kirtan',
  gu: 'નમૂના કીર્તન',
  hi: 'नमूना कीर्तन',
  long: 'A very long placeholder presentation name that does not fit · નમૂના કીર્તન લાંબું નામ · नमूना कीर्तन',
};

const COLOURS: { name: string; job: string }[] = [
  { name: 'ink', job: 'The window, behind panels' },
  { name: 'panel', job: 'Panels' },
  { name: 'panel-2', job: 'Raised: fields, cards, hover' },
  { name: 'panel-3', job: 'Pressed and selected' },
  { name: 'line', job: 'Dividers' },
  { name: 'line-strong', job: 'Dividers that must be seen' },
  { name: 'field', job: 'Edges of controls (3:1)' },
  { name: 'fg', job: 'Text' },
  { name: 'muted', job: 'Secondary text' },
  { name: 'faint', job: 'The quietest text allowed' },
  { name: 'accent', job: 'Focus ring, selection' },
  { name: 'accent-strong', job: 'The primary button' },
  { name: 'live', job: 'On the screens now (with a label)' },
  { name: 'warning', job: 'Missing, can’t play' },
  { name: 'success', job: 'Connected, showing' },
  { name: 'danger', job: 'Removing, deleting' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 border-t border-line py-8" id={id}>
      <h2 id={`${id}-h`} className="text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <SectionTitle>{label}</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'live', 'warning'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];

function ButtonsSection() {
  const [blackout, setBlackout] = useState(false);
  return (
    <Section id="buttons" title="Buttons">
      {SIZES.map((size) => (
        <Row key={size} label={`Size ${size}`}>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant[0]?.toUpperCase()}
              {variant.slice(1)}
            </Button>
          ))}
          <Button size={size} disabled>
            Disabled
          </Button>
        </Row>
      ))}
      <Row label="With an icon and a key hint">
        <Button icon={Import}>Import…</Button>
        <Button icon={Plus} variant="ghost" size="sm">
          Prop
        </Button>
        <Button variant="primary" icon={Eraser} kbd="F1">
          Clear all
        </Button>
        <Button
          variant={blackout ? 'live' : 'secondary'}
          aria-pressed={blackout}
          kbd="B"
          onClick={() => setBlackout(!blackout)}
        >
          {blackout ? 'Black-out is on' : 'Black-out'}
        </Button>
      </Row>
      <Row label="Icon buttons (label read out, and shown as a tooltip)">
        {SIZES.map((size) => (
          <IconButton key={size} icon={MoreHorizontal} label="More for this playlist" size={size} />
        ))}
        <IconButton icon={Pencil} label="Edit words" variant="secondary" />
        <IconButton icon={Trash2} label="Delete this prop" variant="danger" />
        <IconButton icon={X} label="Close" kbd="Esc" />
      </Row>
      <Row label="Simple Mode (xl and xxl)">
        <Button size="xxl" variant="secondary" icon={SkipBack}>
          Back
        </Button>
        <Button size="xxl" variant="primary" iconEnd={SkipForward}>
          Next
        </Button>
        <Button size="xl" variant="secondary" icon={Ban}>
          Black out
        </Button>
        <Button size="xl" variant="live" icon={Stamp}>
          Logo is on
        </Button>
      </Row>
    </Section>
  );
}

function ChoicesSection() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [tick, setTick] = useState(true);
  const [tab, setTab] = useState<'presentations' | 'media'>('presentations');
  return (
    <Section id="choices" title="Toggles and tabs">
      <Row label="Toggles">
        <Toggle checked={on} onChange={setOn} label="Screen on" />
        <Toggle checked={off} onChange={setOff} label="Loop the video" />
        <Toggle checked={on} onChange={setOn} label="Large toggle" size="lg" />
        <Toggle checked={false} onChange={() => undefined} label="Disabled" disabled />
        <Checkbox
          label="Keep counting below zero"
          checked={tick}
          onChange={(e) => setTick(e.target.checked)}
        />
      </Row>
      <div className="max-w-md space-y-2 rounded-lg border border-line bg-panel p-3">
        <Tabs
          group="gallery-library"
          label="Library"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'presentations', label: 'Presentations', icon: Presentation },
            { id: 'media', label: 'Media', icon: Image, extra: <Badge>12</Badge> },
          ]}
        />
        <TabPanel group="gallery-library" id={tab} className="p-2 text-sm text-muted">
          {tab === 'presentations' ? 'The presentations tab.' : 'The media tab.'}
        </TabPanel>
      </div>
    </Section>
  );
}

function RowsSection() {
  const [selected, setSelected] = useState('two');
  return (
    <Section id="rows" title="Panels and list rows">
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Panel
          title="Playlists"
          icon={ListMusic}
          className="rounded-lg border border-line bg-panel"
          bodyClassName="space-y-1 px-2 pb-2"
          actions={<IconButton icon={FolderPlus} label="New playlist or folder" size="sm" />}
        >
          {[
            { id: 'one', title: NAMES.en, sub: '3 slides' },
            { id: 'two', title: NAMES.gu, sub: '12 slides' },
            { id: 'three', title: NAMES.hi, sub: '8 slides' },
            { id: 'four', title: NAMES.long, sub: 'A name too long to fit' },
          ].map((r) => (
            <ListRow
              key={r.id}
              title={r.title}
              subtitle={r.sub}
              selected={selected === r.id}
              aria-current={selected === r.id ? 'true' : undefined}
              trailing={r.id === 'two' ? <LiveBadge /> : undefined}
              onClick={() => setSelected(r.id)}
            />
          ))}
        </Panel>
        <Panel
          title="States of a row"
          collapsible
          className="rounded-lg border border-line bg-panel"
          bodyClassName="space-y-1 px-2 pb-2"
        >
          <ListRow title="Marked (one of several)" marked density="compact" />
          <ListRow title="Something would drop here" dropTarget density="compact" />
          <ListRow title="Placeholder video.mp4" subtitle="Video" trailing={<MissingBadge />} />
          <ListRow
            title="Placeholder clip.avi"
            subtitle="Video"
            trailing={<UnplayableBadge title="AVI: Drashti cannot play it yet" />}
          />
        </Panel>
      </div>
      <Row label="Truncated names show in full on hover">
        <span className="w-64 rounded-md border border-line px-2 py-1">
          <Truncate text={NAMES.long} />
        </span>
      </Row>
    </Section>
  );
}

function OverlaysSection() {
  const [dialog, setDialog] = useState<'center' | 'right' | 'confirm' | null>(null);
  const [menu, setMenu] = useState<MenuPlace | null>(null);
  const entries: MenuEntry[] = [
    { label: 'Open', icon: Monitor, onSelect: () => undefined },
    { label: 'Rename…', icon: Pencil, onSelect: () => undefined, kbd: '↩' },
    { label: 'Not now', onSelect: () => undefined, disabled: true },
    { label: 'Remove…', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => undefined },
  ];
  return (
    <Section id="overlays" title="Dialogs, menus and tooltips">
      <Row label="Dialogs">
        <Button onClick={() => setDialog('center')}>Open a dialog</Button>
        <Button onClick={() => setDialog('right')}>Open a side sheet</Button>
        <Button variant="danger" onClick={() => setDialog('confirm')}>
          Ask before removing
        </Button>
      </Row>
      <Row label="Menus">
        <MenuButton label="Playlist" entries={entries} icon={MoreHorizontal} title="Playlist actions" />
        <MenuButton label="Import" entries={entries} variant="secondary" icon={Import}>
          Import…
        </MenuButton>
        <button
          type="button"
          className="rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-muted"
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(menuPlace(e));
          }}
        >
          Right-click here
        </button>
        {menu && <Menu at={menu} label="Example" entries={entries} onClose={() => setMenu(null)} />}
      </Row>
      <Row label="Tooltips and key hints">
        <Tooltip content="Shows the words of the selected presentation">
          <Button>Hover or focus me</Button>
        </Tooltip>
        <span className="text-sm text-muted">
          Next <Kbd>→</Kbd> · Clear all <Kbd>F1</Kbd> · Screens <Kbd>⌘⇧S</Kbd>
        </span>
      </Row>
      {dialog === 'center' && (
        <Dialog
          title="Words of “Placeholder Kirtan”"
          subtitle="A dialog in the middle"
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialog(null)}>
                Save
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Tab stays inside the dialog, Esc closes it.</p>
        </Dialog>
      )}
      {dialog === 'right' && (
        <Dialog
          title="Screens"
          placement="right"
          size="lg"
          closeLabel="Close screens"
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-muted">A side sheet, for settings next to the show.</p>
        </Dialog>
      )}
      {dialog === 'confirm' && (
        <ConfirmDialog
          title="Remove “Placeholder Kirtan”?"
          confirmLabel="Remove"
          onConfirm={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        >
          <p>You can bring it back with Undo (⌘Z).</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

function FieldsSection() {
  const [size, setSize] = useState(72);
  const [colour, setColour] = useState('#ffffff');
  const [volume, setVolume] = useState(0.8);
  return (
    <Section id="fields" title="Form fields">
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Field label="Theme name" hint="Up to 80 letters">
          <TextInput defaultValue="Placeholder theme" />
        </Field>
        <Field label="Group name" error="A group needs a name.">
          <TextInput defaultValue="" placeholder="For example Main Hall" />
        </Field>
        <Field label="Size">
          <NumberInput
            value={size}
            min={8}
            max={600}
            unit="px"
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </Field>
        <Field label="Scaling">
          <Select defaultValue="fit">
            <option value="fit">Fit (letterbox)</option>
            <option value="fill">Fill (crop)</option>
            <option value="stretch">Stretch</option>
          </Select>
        </Field>
        <Field label="Colour">
          <ColorInput value={colour} onChange={(e) => setColour(e.target.value)} />
        </Field>
        <Field label="Volume">
          <Slider
            value={volume}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </Field>
        <Field label="Words" className="col-span-2">
          <Textarea rows={4} defaultValue={'[Verse 1]\nPlaceholder line one\nનમૂના પંક્તિ\n\nनमूना पंक्ति'} />
        </Field>
      </div>
    </Section>
  );
}

function StatesSection() {
  return (
    <Section id="states" title="Notices, badges and empty states">
      <div className="grid max-w-3xl gap-2">
        <Notice tone="info">
          Diagnostics saved on the Desktop: Drashti diagnostics 2026-10-01 18-30.txt
        </Notice>
        <Notice tone="success" role="none">
          Library backed up.
        </Notice>
        <Notice
          tone="warning"
          title="Sound output not connected"
          role="none"
          actions={<Button size="sm">Choose another</Button>}
          onDismiss={() => undefined}
        >
          Sound is playing on the system default until it is back.
        </Notice>
        <Notice tone="danger" role="none" compact>
          The import stopped: the disk is full.
        </Notice>
      </div>
      <Row label="Badges">
        <LiveBadge />
        <Badge tone="live">Black-out</Badge>
        <MissingBadge />
        <UnplayableBadge />
        <Badge tone="success">Showing</Badge>
        <Badge>3 missing</Badge>
        <Badge tone="info">Default</Badge>
      </Row>
      <Row label="Progress">
        <Progress value={0.4} label="Copying the media" className="w-64" />
      </Row>
      <div className="grid max-w-3xl grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-panel">
          <EmptyState icon={ListMusic} title="No playlists yet" compact>
            Make one with New, or import a playlist file.
          </EmptyState>
        </div>
        <div className="rounded-lg border border-line bg-panel">
          <Loading />
        </div>
        <div className="rounded-lg border border-line bg-panel">
          <ErrorState title="Could not load the themes" action={<Button size="sm">Try again</Button>} />
        </div>
      </div>
    </Section>
  );
}

function SplitterSection() {
  const [width, setWidth] = useState(240);
  return (
    <Section id="splitter" title="Resizing panels">
      <div className="flex h-40 max-w-3xl overflow-hidden rounded-lg border border-line">
        <div style={{ width }} className="shrink-0 bg-panel p-3 text-sm text-muted">
          {width} px: drag the handle, or focus it and use the arrow keys.
        </div>
        <Splitter
          value={width}
          onChange={setWidth}
          min={160}
          max={480}
          defaultValue={240}
          label="Resize the example panel"
        />
        <div className="flex-1 bg-ink p-3 text-sm text-muted">The rest</div>
      </div>
    </Section>
  );
}

function ColoursSection() {
  return (
    <Section id="colours" title="Colours and type">
      <ul className="grid grid-cols-4 gap-2">
        {COLOURS.map((c) => (
          <li key={c.name} className="flex items-center gap-2 rounded-md border border-line bg-panel p-2">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-sm border border-line-strong"
              style={{ background: `var(--color-${c.name})` }}
            />
            <span className="min-w-0">
              <span className="block font-mono text-xs">{c.name}</span>
              <span className="block text-xs text-muted">{c.job}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-1">
        <p className="text-2xl font-bold">
          {NAMES.en} · {NAMES.gu} · {NAMES.hi}
        </p>
        <p className="text-base font-medium">
          {NAMES.en} · {NAMES.gu} · {NAMES.hi}
        </p>
        <p className="text-sm">
          {NAMES.en} · {NAMES.gu} · {NAMES.hi}
        </p>
        <p className="text-xs text-muted">
          {NAMES.en} · {NAMES.gu} · {NAMES.hi}
        </p>
      </div>
    </Section>
  );
}

const SECTIONS = [
  ['colours', 'Colours and type'],
  ['buttons', 'Buttons'],
  ['choices', 'Toggles and tabs'],
  ['rows', 'Panels and rows'],
  ['overlays', 'Dialogs and menus'],
  ['fields', 'Form fields'],
  ['states', 'Notices and states'],
  ['splitter', 'Resizing'],
] as const;

export function Gallery() {
  return (
    <div className="flex h-full">
      <nav aria-label="Sections" className="w-48 shrink-0 space-y-1 border-r border-line bg-panel p-4">
        <p className="mb-3 text-sm font-bold">Drashti components</p>
        {SECTIONS.map(([id, title]) => (
          <a
            key={id}
            href={`#${id}`}
            className="block rounded-md px-2 py-1 text-sm text-muted hover:bg-panel-2 hover:text-fg"
          >
            {title}
          </a>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-8 pb-16" data-testid="gallery">
        <h1 className="pt-8 text-2xl font-bold">Component gallery</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every shared component in <code className="font-mono">src/renderer/src/ui/</code>, in each of its
          states. The rules are in <code className="font-mono">docs/design.md</code>. Placeholder text only.
        </p>
        <ColoursSection />
        <ButtonsSection />
        <ChoicesSection />
        <RowsSection />
        <OverlaysSection />
        <FieldsSection />
        <StatesSection />
        <SplitterSection />
      </main>
    </div>
  );
}
