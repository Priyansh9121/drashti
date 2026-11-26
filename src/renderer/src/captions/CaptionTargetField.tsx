import {
  CAPTION_TARGET_NAMES,
  CAPTION_TARGETS,
  translationTarget,
  type CaptionTarget,
} from '../../../shared/caption-translation';
import type { CaptionSettings, CaptionsStatus } from '../../../shared/captions';
import { Button } from '../ui/Button';
import { Field, Select } from '../ui/Field';
import { Notice } from '../ui/Notice';
import {
  captionTargetHint,
  captionTargetReason,
  captionTargetWhyNot,
  chosenTarget,
  chosenUnavailableText,
  faultText,
  sameLanguageText,
  skippedText,
  TRANSLATION_HOW,
  TRANSLATION_TRIAL_WARNING,
  translationOf,
  triedAgainOnChoosing,
} from './caption-target-words';

/**
 * "Captions in" (alpha.24, QA24-CAPLANG-2, the owner's 2a-2f, all A), under Speaker's language in File › Live
 * Captions… (Pro Mode only; Simple Mode has no dialog): one choice for the whole show, the speaker's own words (the
 * default) or a translation into Gujarati, Hindi or English, each a trial. The translations are greyed out, with the
 * reason as the field's hint, while this computer cannot translate (2f); the speaker's own language is greyed out (it
 * would be the speaker's words again). Once a translation is chosen: the Trial warning (2e), how it shows, the phrases
 * skipped (no live region: it would be noisy while someone speaks) and the engine's last fault (2c).
 */
export function CaptionTargetField({
  view,
  save,
}: {
  view: CaptionsStatus;
  save: (next: CaptionSettings) => void;
}) {
  const settings = view.settings;
  const chosen = chosenTarget(view);
  const speaker = settings.language;
  const t = translationOf(view);
  const whyNot = captionTargetWhyNot(view);
  // Greyed out while choosing cannot mend it; after slowness or the engine's fault choosing again tries once more.
  const greyed = whyNot !== null && !triedAgainOnChoosing(captionTargetReason(view) ?? null);
  // A pair that translates (2d): "as heard", Sanskrit and the speaker's own language show the speaker's words.
  const translating = translationTarget(speaker, chosen) !== null;
  const same = sameLanguageText(view);
  const unavailable = chosenUnavailableText(view);
  return (
    <div className="space-y-2" data-testid="captions-target-section">
      <Field
        label="Captions in"
        hint={<span data-testid="captions-target-hint">{whyNot ?? captionTargetHint(view)}</span>}
      >
        <Select
          data-testid="captions-target"
          className="w-full"
          value={chosen}
          // Nothing to choose but the speaker's own words: greyed out, its hint says why. A translation chosen
          // earlier keeps it open, so the speaker's own words can be chosen again.
          disabled={greyed && chosen === 'same'}
          onChange={(e) => {
            save({ ...settings, captionLanguage: e.target.value as CaptionTarget });
          }}
        >
          {CAPTION_TARGETS.map((id) => (
            <option key={id} value={id} disabled={id !== 'same' && (greyed || id === speaker)}>
              {CAPTION_TARGET_NAMES[id]}
            </option>
          ))}
        </Select>
      </Field>
      {same !== null && (
        <p className="text-sm text-muted" data-testid="captions-target-same">
          {same}
        </p>
      )}
      {unavailable !== null && (
        <Notice
          tone={unavailable.tone}
          data-testid="captions-target-unavailable"
          actions={
            unavailable.retry ? (
              // A select cannot choose its own value again: Try again saves the same choice again.
              <Button
                size="sm"
                data-testid="captions-target-retry"
                onClick={() => {
                  save({ ...settings });
                }}
              >
                Try again
              </Button>
            ) : undefined
          }
        >
          {unavailable.text}
        </Notice>
      )}
      {translating && (
        <>
          <Notice tone="warning" data-testid="captions-target-trial">
            {TRANSLATION_TRIAL_WARNING}
          </Notice>
          <p className="text-sm text-muted" data-testid="captions-target-how">
            {TRANSLATION_HOW}
          </p>
          <p className="text-sm" data-testid="captions-target-skipped">
            {skippedText(t.skipped)}
          </p>
          {t.fault !== null && (
            <Notice tone="danger" data-testid="captions-target-fault">
              {faultText(t.fault)}
            </Notice>
          )}
        </>
      )}
      <p className="text-sm text-muted">File › Caption Language does the same during the show.</p>
    </div>
  );
}
