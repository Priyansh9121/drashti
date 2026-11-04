import { useEffect } from 'react';
import {
  CAPTION_MODEL_IDS,
  CAPTION_MODELS,
  CAPTION_PLACES,
  CAPTION_SIZES,
  type CaptionModelId,
  type CaptionPlace,
  type CaptionSettings,
  type CaptionSize,
  type CaptionsStatus,
} from '../../../shared/captions';
import type { SpeechLanguage } from '../../../shared/speech';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { Toggle } from '../ui/Toggle';
import { closeCaptions, connectCaptions, takeCaptions, useCaptions } from './captions-store';
import { captionsStateText, downloadText, megabytes } from './captions-words';

/*
 * File › Live Captions… (Session 55, Part 10; Pro Mode): speech from the stream's sound input as captions on the
 * stream and the stage screens, and on the audience screens if chosen. On or off on this computer (off until an
 * admin turns it on), the model (downloaded once), the language, and the captions' size and place. Marked Trial:
 * Gujarati is not good enough yet with any free model.
 */

const LANGUAGES: { id: SpeechLanguage | 'auto'; name: string }[] = [
  { id: 'auto', name: 'Gujarati, Hindi or English, as heard' },
  { id: 'gu', name: 'Gujarati (trial)' },
  { id: 'hi', name: 'Hindi' },
  { id: 'en', name: 'English' },
];
const SIZE_NAMES: Record<CaptionSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const PLACE_NAMES: Record<CaptionPlace, string> = { bottom: 'Along the bottom', top: 'Along the top' };

export function CaptionsDialog() {
  const open = useCaptions((s) => s.open);
  const view = useCaptions((s) => s.view);
  useEffect(() => {
    connectCaptions();
  }, []);
  if (!open || !view) return null;
  return <CaptionsForm view={view} />;
}

function CaptionsForm({ view }: { view: CaptionsStatus }) {
  const settings = view.settings;
  const save = (next: CaptionSettings) => {
    takeCaptions(window.drashti.captions.setSettings(next));
  };
  return (
    <Dialog
      title="Live captions"
      size="md"
      onClose={closeCaptions}
      closeLabel="Close live captions"
      testId="captions-dialog"
      footer={<Button onClick={closeCaptions}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone="warning" data-testid="captions-trial">
            Trial
          </Badge>
          <p className="text-sm text-muted">
            English is good, Hindi fair (best with Most accurate), Gujarati not good enough yet.
          </p>
        </div>
        <p className="text-sm text-muted">
          What is said into the stream’s sound input shows as captions on the stream and the stage screens,
          and on the audience screens if you choose. Captions are worked out on this computer: Drashti does
          not keep or log the sound or the words it hears, and phones never get them. The captions are part of
          the stream’s picture, so they go to YouTube and into the stream’s recordings.
        </p>
        <Toggle
          checked={view.on}
          label="Live captions on this computer (Trial). Can slow the screens while on."
          disabled={!view.engine}
          data-testid="captions-on"
          onChange={(on) => {
            takeCaptions(window.drashti.captions.setOn(on));
          }}
        />
        <p className="text-sm" role="status" data-testid="captions-state" data-phase={view.speech.phase}>
          {captionsStateText(view)}
        </p>
        <Field label="Model">
          <Select
            data-testid="captions-model"
            className="w-full"
            value={view.model}
            onChange={(e) => {
              takeCaptions(window.drashti.captions.setModel(e.target.value as CaptionModelId));
            }}
          >
            {CAPTION_MODEL_IDS.map((id) => (
              <option key={id} value={id}>
                {CAPTION_MODELS[id].name}, {megabytes(CAPTION_MODELS[id].bytes)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2" data-testid="captions-download" data-phase={view.download.phase}>
          {view.download.phase === 'downloading' && (
            <Progress
              value={view.download.done / Math.max(1, view.download.total)}
              label="Downloading the model"
            />
          )}
          {view.download.phase === 'failed' ? (
            <Notice tone="danger">
              {downloadText(view)}{' '}
              <Button
                size="sm"
                data-testid="captions-retry"
                onClick={() => {
                  takeCaptions(window.drashti.captions.retry());
                }}
              >
                Try again
              </Button>
            </Notice>
          ) : (
            <p className="text-sm text-muted">{downloadText(view)}</p>
          )}
        </div>
        <Field label="Language">
          <Select
            data-testid="captions-language"
            className="w-full"
            value={settings.language}
            onChange={(e) => {
              save({ ...settings, language: e.target.value as SpeechLanguage | 'auto' });
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        {settings.language === 'gu' && (
          <Notice tone="warning" data-testid="captions-gujarati-trial">
            Gujarati is a trial: no free model hears it well yet, so many words will be wrong. Try it before a
            sabha, never for the first time during one.
          </Notice>
        )}
        {settings.language === 'auto' && (
          <p className="text-sm text-muted">
            Choosing one language is more accurate: as heard, Gujarati is often taken for Hindi.
          </p>
        )}
        <Toggle
          checked={settings.audience}
          label="Show them on the audience screens too"
          data-testid="captions-audience"
          onChange={(audience) => {
            save({ ...settings, audience });
          }}
        />
        <div className="flex gap-3">
          <Field label="Size" className="flex-1">
            <Select
              data-testid="captions-size"
              className="w-full"
              value={settings.size}
              onChange={(e) => {
                save({ ...settings, size: e.target.value as CaptionSize });
              }}
            >
              {CAPTION_SIZES.map((s) => (
                <option key={s} value={s}>
                  {SIZE_NAMES[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Place" className="flex-1">
            <Select
              data-testid="captions-place"
              className="w-full"
              value={settings.place}
              onChange={(e) => {
                save({ ...settings, place: e.target.value as CaptionPlace });
              }}
            >
              {CAPTION_PLACES.map((p) => (
                <option key={p} value={p}>
                  {PLACE_NAMES[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
