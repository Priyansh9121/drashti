import type { Lang } from '../../../shared/model';
import type { ScreenRole } from '../../../shared/screens';
import { useEngine } from '../engine/engine-store';
import { openStageLayouts, STANDARD } from '../stage/stage-layouts-store';
import { Button } from '../ui/Button';
import { LayoutTemplate } from '../ui/icons';
import { useSavedSetting } from '../ui/saved-setting';
import { LanguagePicker } from './LanguagePicker';
import { screensAction, useScreens } from './screens-store';

/*
 * A screen group's languages for a kirtan's slides, in Screens (and the Stream panel for the stream's group): Session
 * 55, Part 12, moved them here from the group's Look, as Looks went. As Screens' setup has them (which a save answers
 * with, so a refused tick goes back), each tick saved at once; a second tick before the first is saved is made to the
 * first (ui/saved-setting.ts). A stage group's say where its layout is chosen, as its Look's did.
 */
export function GroupLanguages({ groupId, role }: { groupId: string; role: ScreenRole }) {
  const saved = useScreens((s) => s.snapshot?.groups.find((g) => g.id === groupId)?.languages ?? null);
  const [languages, setLanguages] = useSavedSetting<Lang[] | null>(
    `${groupId}:languages`,
    saved ? [...saved] : null,
    (next) => screensAction(() => window.drashti.screens.setGroupLanguages(groupId, next)),
  );
  return (
    <div
      className="space-y-2 rounded-lg border border-line bg-panel px-3 py-2.5"
      data-testid="group-languages"
    >
      {role === 'stage' && <StageLayoutNote />}
      <LanguagePicker
        label={
          role === 'stream' ? 'A kirtan’s languages on the stream' : 'A kirtan’s languages on these screens'
        }
        value={languages}
        onChange={setLanguages}
      />
    </div>
  );
}

/** Session 55: one layout for every stage screen, chosen in the Stage screen panel under LIVE; and its editor. */
function StageLayoutNote() {
  const stageLayoutId = useEngine((s) => s.state?.stage?.layout?.id ?? null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs text-muted" data-testid="look-stage-layout-note">
        The stage layout is chosen for every stage screen in the Stage screen panel, under LIVE.
      </p>
      <Button
        size="sm"
        icon={LayoutTemplate}
        data-testid="edit-stage-layouts"
        onClick={() => {
          openStageLayouts(stageLayoutId ?? STANDARD);
        }}
      >
        Edit stage layouts…
      </Button>
    </div>
  );
}
