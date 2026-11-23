import { useMemo } from 'react';
import type { EngineState } from '../../../shared/engine/state';
import type { ScreenGroupConfig } from '../../../shared/screens';
import { translationProblems } from '../../../shared/prepared-translation-status';
import { checkedTranslationView } from '../../../shared/prepared-translation-view';
import { translationBottom, translationTop } from '../../../shared/prepared-output-state';
import { lowerThirdOf } from '../../../shared/program';
import { useScreens } from '../screens/screens-store';
import { useStream } from '../stream/stream-store';
import { Button } from '../ui/Button';
import { dispatch } from './actions';
import { useMode } from './mode-store';
const NO_GROUPS: ScreenGroupConfig[] = [];

export function PreparedTranslationStatus({ state }: { state: EngineState | null }) {
  const groups = useScreens((value) => value.snapshot?.groups ?? NO_GROUPS);
  const streamLayout = useStream((value) => value.status?.layout);
  const pro = useMode((value) => value.mode === 'pro');
  const slide = state?.layers.slide?.slide;
  const hidden = state?.translationHidden === true;
  const height = slide?.height ?? 1080;
  const hallBottom = state ? translationBottom(state, height) : height;
  const hallTop = state ? translationTop(state, height) : 0;
  const stageBottom = state ? translationBottom(state, height, 'stage') : height;
  const stageTop = state ? translationTop(state, height, 'stage') : 0;
  const streamBottom = state ? translationBottom(state, height, 'stream', streamLayout === 'camera') : height;
  const streamTop = state ? translationTop(state, height, 'stream', streamLayout === 'camera') : 0;
  const problems = useMemo(() => {
    if (!slide || hidden) return [];
    const destinations = groups.flatMap((group) => {
      const bands =
        group.role === 'stage'
          ? { blockedAbove: stageTop, blockedBelow: stageBottom }
          : group.role === 'stream'
            ? { blockedAbove: streamTop, blockedBelow: streamBottom }
            : { blockedAbove: hallTop, blockedBelow: hallBottom };
      return group.screens.length
        ? group.screens.map((screen) => ({
            name: screen.name,
            role: group.role,
            where: {
              groupId: group.id,
              outputId: screen.id,
              ...(group.role === 'stage'
                ? {}
                : {
                    canvas:
                      group.role === 'stream'
                        ? { width: 1920, height: 1080 }
                        : { width: screen.canvasWidth, height: screen.canvasHeight },
                    scaling: group.role === 'stream' ? ('fit' as const) : screen.scaling,
                  }),
              ...bands,
            },
          }))
        : [{ name: group.name, role: group.role, where: { groupId: group.id, ...bands } }];
    });
    const messages = destinations.flatMap(({ name, role, where }) => {
      const words = translationProblems(slide, where).map((message) => `${name}: ${message}`);
      if (role === 'stream' && streamLayout === 'camera') {
        const projected = checkedTranslationView(slide, where);
        const lower = lowerThirdOf(projected, null);
        if (
          lower.total > lower.lines.length &&
          projected.elements.some((el) => el.kind === 'text' && el.preparedTranslation)
        )
          words.push(`${name}: Translation held: the lower third needs room for every source line.`);
      }
      return words;
    });
    return [...new Set(messages)];
  }, [
    slide,
    groups,
    hidden,
    hallBottom,
    hallTop,
    stageBottom,
    stageTop,
    streamBottom,
    streamTop,
    streamLayout,
  ]);
  const configured = slide?.elements.some(
    (el) =>
      el.kind === 'text' &&
      el.translationDisplay &&
      (el.translationDisplay.choice !== 'off' ||
        Object.values(el.translationDisplay.groups).some((value) => value !== 'off') ||
        Object.values(el.translationDisplay.outputs).some((value) => value !== 'off')),
  );
  if (!configured && !hidden) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="prepared-translation-status">
      <p role="status" className="min-w-0 flex-1 text-xs text-muted" title={problems.join(' ')}>
        {hidden
          ? 'Translations hidden.'
          : problems.length
            ? `${problems[0] ?? ''}${problems.length > 1 ? ` ${problems.length - 1} more: check Translation in Edit slides.` : ''}`
            : 'Checked translations only.'}
      </p>
      {pro && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void dispatch({ type: 'setTranslationHidden', hidden: !hidden });
          }}
        >
          {hidden ? 'Show checked translation' : 'Hide translation'}
        </Button>
      )}
    </div>
  );
}
