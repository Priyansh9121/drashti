import { useState } from 'react';
import type { GroupLook, LookInfo, LookLayer, SlideStyle } from '../../../shared/looks';
import { LOOK_LAYER_NAMES, LOOK_LAYERS } from '../../../shared/looks';
import type { ScreenRole } from '../../../shared/screens';
import { useEngine } from '../engine/engine-store';
import { lookAction, useLooks } from '../looks/looks-store';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Select, TextInput } from '../ui/Field';
import { ArrowLeft, ArrowRight, CopyPlus, Plus, Trash2 } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Tabs } from '../ui/Tabs';
import { Checkbox } from '../ui/Toggle';
import { LanguagePicker } from './LanguagePicker';

/*
 * Looks in Screens: the list (the first is the one Drashti starts with), the
 * one whose settings the group cards show, and each group's settings in it.
 * Switching the live Look is a show action, in the main window's Looks list.
 */

const looks = () => window.drashti.looks;

/** A name for a new Look that no other has. */
function freshName(taken: readonly LookInfo[], base: string): string {
  const names = new Set(taken.map((l) => l.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The Looks, which one the cards below show, and changes to it. */
export function LooksSection({
  lookId,
  onChoose,
}: {
  /** The Look the cards below show. */
  lookId: string;
  onChoose: (id: string) => void;
}) {
  const view = useLooks((s) => s.view);
  const error = useLooks((s) => s.error);
  const liveId = useEngine((s) => s.state?.look.id ?? '');
  const [askRemove, setAskRemove] = useState(false);
  const list = view?.looks ?? [];
  const at = list.findIndex((l) => l.id === lookId);
  const chosen = list[at];
  const [name, setName] = useState(chosen?.name ?? '');
  const [shown, setShown] = useState(chosen?.name);
  if (shown !== chosen?.name) {
    setShown(chosen?.name);
    setName(chosen?.name ?? '');
  }
  if (!view || !chosen) return null;
  const make = async (copyOf: string | null) => {
    const name = freshName(list, copyOf ? `${chosen.name} copy` : 'New Look');
    const before = new Set(list.map((l) => l.id));
    await lookAction(() => looks().create(name, copyOf));
    const made = useLooks.getState().view?.looks.find((l) => !before.has(l.id));
    if (made) onChoose(made.id);
  };
  return (
    <section className="space-y-2 rounded-xl border border-line bg-panel-2 p-3" data-testid="looks-section">
      <div className="flex items-center gap-2">
        <SectionTitle className="flex-1">Looks</SectionTitle>
        <Button size="sm" icon={Plus} onClick={() => void make(null)} data-testid="new-look">
          New Look
        </Button>
      </div>
      <p className="text-xs text-muted">
        A Look says what every screen group shows. One is live at a time: switch it from Looks in the main
        window. The first Look is the one Drashti starts with. The groups below show their settings in the
        Look chosen here.
      </p>
      <Tabs
        group="looks"
        label="The Look whose settings are shown"
        size="sm"
        className="flex-wrap"
        items={list.map((l) => ({
          id: l.id,
          label: l.name,
          extra:
            l.id === liveId ? (
              <Badge tone="live" className="ml-1">
                Live
              </Badge>
            ) : undefined,
        }))}
        value={lookId}
        onChange={onChoose}
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          aria-label="Look name"
          className="min-w-40 flex-1"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={() => {
            if (name.trim() && name !== chosen.name) void lookAction(() => looks().rename(chosen.id, name));
            else setName(chosen.name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <Button size="sm" icon={CopyPlus} onClick={() => void make(chosen.id)}>
          Duplicate
        </Button>
        <Button
          size="sm"
          icon={ArrowLeft}
          disabled={at <= 0}
          onClick={() => void lookAction(() => looks().move(chosen.id, at - 1))}
        >
          Earlier
        </Button>
        <Button
          size="sm"
          icon={ArrowRight}
          disabled={at >= list.length - 1}
          onClick={() => void lookAction(() => looks().move(chosen.id, at + 1))}
        >
          Later
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={Trash2}
          disabled={list.length <= 1}
          onClick={() => {
            setAskRemove(true);
          }}
        >
          Remove
        </Button>
      </div>
      {askRemove && (
        <ConfirmDialog
          title={`Remove the Look “${chosen.name}”?`}
          confirmLabel="Remove"
          onCancel={() => {
            setAskRemove(false);
          }}
          onConfirm={() => {
            setAskRemove(false);
            void lookAction(() => looks().remove(chosen.id)).then(() => {
              const first = useLooks.getState().view?.looks[0];
              if (first) onChoose(first.id);
            });
          }}
          testId="remove-look-confirm"
        >
          <p>
            {chosen.id === liveId
              ? 'It is live now: the screens change to the first Look at once.'
              : 'The screens do not change: it is not live.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

const SLIDE_STYLE_NAMES: Record<SlideStyle, string> = {
  designed: 'As designed',
  lowerThird: 'As a lower third (the words in a box along the bottom)',
};

/** One group's settings in a Look: its layers, its slide style and a kirtan's languages. */
export function GroupLookSettings({
  look,
  groupId,
  role,
}: {
  look: LookInfo;
  groupId: string;
  role: ScreenRole;
}) {
  const settings: GroupLook | undefined = look.groups[groupId];
  if (!settings) return null;
  const set = (patch: Partial<GroupLook>) => void lookAction(() => looks().setGroup(look.id, groupId, patch));
  const toggle = (layer: LookLayer, on: boolean) => {
    const next = on ? [...settings.layers, layer] : settings.layers.filter((l) => l !== layer);
    set({ layers: LOOK_LAYERS.filter((l) => next.includes(l)) });
  };
  const picture = role !== 'stage' && role !== 'stream';
  return (
    <div
      className="space-y-3 rounded-lg border border-line bg-panel px-3 py-2.5"
      data-testid="group-look"
      data-look={look.id}
    >
      <p className="text-xs font-medium text-muted">In the Look “{look.name}”</p>
      {picture && (
        <>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-muted">Layers on these screens</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {LOOK_LAYERS.map((layer) => (
                <Checkbox
                  key={layer}
                  label={LOOK_LAYER_NAMES[layer]}
                  checked={settings.layers.includes(layer)}
                  data-testid={`look-layer-${layer}`}
                  onChange={(e) => {
                    toggle(layer, e.target.checked);
                  }}
                />
              ))}
            </div>
          </fieldset>
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
            Slides
            <Select
              aria-label="How slides are drawn"
              data-testid="look-slides"
              value={settings.slides}
              onChange={(e) => {
                set({ slides: e.target.value === 'lowerThird' ? 'lowerThird' : 'designed' });
              }}
            >
              {(['designed', 'lowerThird'] as const).map((s) => (
                <option key={s} value={s}>
                  {SLIDE_STYLE_NAMES[s]}
                </option>
              ))}
            </Select>
          </label>
        </>
      )}
      <LanguagePicker
        label={
          role === 'stream' ? 'A kirtan’s languages on the stream' : 'A kirtan’s languages on these screens'
        }
        value={settings.languages}
        onChange={(languages) => {
          set({ languages });
        }}
      />
    </div>
  );
}
