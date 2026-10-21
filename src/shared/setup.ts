import { z } from 'zod';
import type { AudioDevice } from './audio';
import { audioDeviceSchema } from './audio';
import type { KirtanLang, Lang, RenderSlide, TextElement } from './model';
import { idSchema } from './model-schema';
import type { DisplayInfo, ScreensSnapshot } from './screens';
import { groupLanguagesSchema } from './screens-schema';
import { NEW_TEXT_LINE_HEIGHT } from './model';

/*
 * The first-run setup wizard (PLAN.md 3): which output feeds what, the
 * languages each shows, the sound output and the default theme, chosen
 * step by step and applied together at Finish. Nothing changes before.
 */

/** What an output is used for. */
export type OutputUse = 'audience' | 'stage' | 'none';

export interface SetupOutput {
  displayId: number;
  use: OutputUse;
  /** For audience and stage outputs: the languages of a kirtan it shows, in order; null for all. */
  languages: Lang[] | null;
}

export interface SetupPlan {
  /** Each connected display's use; null when the step was skipped (the screens stay as they are). */
  outputs: SetupOutput[] | null;
  /** The sound output: a device, null for the system default, or 'skip' to leave it. */
  sound: AudioDevice | null | 'skip';
  /** The default theme, or null to leave it. */
  themeId: string | null;
}

export type SetupResult =
  | {
      ok: true;
      snapshot: ScreensSnapshot;
      /** How many screens show the test slide now. */
      tested: number;
    }
  /** `confirm`: nothing changed yet; repeat with consent to cover the operator's display. */
  | { ok: false; message: string; confirm?: 'covers-operator' };

/** How the wizard starts: whether this is the first start, and which display holds the controls. */
export interface SetupState {
  /**
   * The wizard opens by itself: a first start, in Pro Mode, never for a volunteer (roles on, the admin PIN
   * not typed; Session 46, when a start with roles on became Pro Mode).
   */
  firstRun: boolean;
  /**
   * The first start's welcome (Session 26g): the lamp lights, then Set up the screens, Try a practice
   * show first, or Skip for now. Once per library, in Pro Mode, never for a volunteer (roles on, the
   * admin PIN not typed), and never in tests unless they ask (DRASHTI_TEST_NO_WIZARD).
   */
  welcome: boolean;
  /** The display the operator window is on (null when outputs never cover it, as in windowed tests). */
  operatorDisplayId: number | null;
  /** The display the operator window is on, windowed outputs or not (Session 44: never offered for the hall). */
  controlsDisplayId: number | null;
  /** Whether the window offers "Show on <display>" (Session 44): Pro Mode, and not in tests unless they ask. */
  offer: boolean;
}

/**
 * The display to offer "Show on <its name>" for (Session 44; Priyansh: "creating a screen shouldnt take this
 * long, make obvious stuff obvious"): while no screen of this computer shows the hall's picture yet (an audience
 * or key-and-fill screen), the first connected display that is not the one with the controls and that no
 * screen uses. One click makes it the hall's screen. Null when there is none to offer.
 */
export function displayToOffer(
  snapshot: Pick<ScreensSnapshot, 'displays' | 'groups' | 'status'>,
  controlsDisplayId: number | null,
): DisplayInfo | null {
  const hall = snapshot.groups.some(
    (g) => (g.role === 'audience' || g.role === 'keyfill') && g.screens.some((s) => s.nodeId === null),
  );
  if (hall) return null;
  const used = new Set(snapshot.status.flatMap((st) => (st.displayId === null ? [] : [st.displayId])));
  return snapshot.displays.find((d) => d.id !== controlsDisplayId && !used.has(d.id)) ?? null;
}

export const setupPlanSchema: z.ZodType<SetupPlan> = z.object({
  outputs: z
    .array(
      z.object({
        displayId: z.number().int().nonnegative(),
        use: z.enum(['audience', 'stage', 'none']),
        languages: groupLanguagesSchema,
      }),
    )
    .max(32)
    .nullable(),
  sound: z.union([audioDeviceSchema, z.null(), z.literal('skip')]),
  themeId: idSchema.nullable(),
});

/** How long the test slide stays on the screens after Finish. */
export const TEST_CARD_MS = 8000;

/** Placeholder lines in each language for test slides: written for Drashti, not kirtan text. */
export const SAMPLE_LINES: Record<KirtanLang, string> = {
  gu: 'પરીક્ષણ સ્લાઇડ',
  hi: 'परीक्षण स्लाइड',
  translit: 'Parīkṣaṇ slāiḍ',
  en: 'A test slide',
};

/** A kirtan slide with a line in each language, for each screen to show in its own languages. */
export function sampleKirtanSlide(width = 1920, height = 1080): RenderSlide {
  const scale = height / 1080;
  const runs = [
    { text: `${SAMPLE_LINES.gu}\n`, lang: 'gu' as const, size: Math.round(96 * scale), weight: 600 },
    { text: `${SAMPLE_LINES.hi}\n`, lang: 'hi' as const, size: Math.round(84 * scale), weight: 600 },
    {
      text: `${SAMPLE_LINES.translit}\n`,
      lang: 'translit' as const,
      size: Math.round(64 * scale),
      italic: true,
    },
    { text: SAMPLE_LINES.en, lang: 'en' as const, size: Math.round(56 * scale) },
  ];
  const box: TextElement = {
    id: 'sample',
    kind: 'text',
    frame: { x: width * 0.08, y: height * 0.32, width: width * 0.84, height: height * 0.56 },
    text: runs.map((r) => r.text).join(''),
    lang: 'gu',
    style: {
      fontFamily: null,
      fontSize: Math.round(96 * scale),
      fontWeight: 500,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: NEW_TEXT_LINE_HEIGHT,
      shadow: true,
      shrinkToFit: true,
    },
    runs,
  };
  return { id: 'setup-test', width, height, background: '#0b1a33', elements: [box], kirtan: true };
}
