import { useEffect, useState } from 'react';
import {
  CAPTION_LONGEST_MS,
  CAPTION_MODEL_IDS,
  CAPTION_MODELS,
  CAPTION_PAUSES_MS,
  CAPTION_PLACES,
  CAPTION_SIZES,
  CAPTION_SPEECH_LEVELS,
  CAPTION_STEPS_MS,
  CAPTION_THREADS,
  type CaptionModelId,
  type CaptionPlace,
  type CaptionSettings,
  type CaptionSize,
  type CaptionsStatus,
  type CaptionTiming,
  type LanguageModelView,
} from '../../../shared/captions';
import type { SpeechLanguage } from '../../../shared/speech';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Progress } from '../ui/Progress';
import { Toggle } from '../ui/Toggle';
import { CaptionWordsSection } from './CaptionWordsDialog';
import { closeCaptions, connectCaptions, takeCaptions, useCaptions } from './captions-store';
import { CaptionPrototypePanel } from './CaptionPrototypePanel';
import {
  captionsStateText,
  downloadText,
  LANGUAGE_NAMES,
  languageModelText,
  LONGEST_NAMES,
  megabytes,
  PAUSE_NAMES,
  SPEECH_LEVEL_NAMES,
  STEP_NAMES,
  THREAD_NAMES,
} from './captions-words';

/*
 * File › Live Captions… (Session 55, Part 10; Pro Mode): speech from the stream's sound input as captions on the
 * stream and the stage screens, and on the audience screens if chosen. On or off on this computer (off until an
 * admin turns it on), the model (downloaded once), the language, and the captions' size and place. Since alpha.22:
 * the speaker's language (File › Speaker's Language too), a model of its own for Gujarati, Hindi or English where
 * this copy knows one, and the live timing on this computer (folded away until asked for).
 */

const LANGUAGES: { id: SpeechLanguage | 'auto'; name: string }[] = [
  { id: 'auto', name: 'Gujarati, Hindi, Sanskrit or English, as heard' },
  { id: 'gu', name: 'Gujarati (trial)' },
  { id: 'hi', name: 'Hindi' },
  { id: 'sa', name: 'Sanskrit (trial)' },
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
            Try captions in rehearsal. Accuracy varies by language and sound.
          </p>
        </div>
        <p className="text-sm text-muted">
          What is said into the stream’s sound input shows as captions on the stream and the stage screens,
          and on the audience screens if you choose. Drashti works out captions on this computer and draws
          them on the stream and its video recording. Phones do not receive the captions. When you record
          sound with captions on, Drashti saves a timed draft beside the audio file.
        </p>
        <CaptionPrototypePanel />
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
        <Field label="Speaker’s language">
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
            Gujarati is a trial. The current models can get many words wrong. Try it in rehearsal.
          </Notice>
        )}
        {settings.language === 'sa' && (
          <Notice tone="warning">
            Sanskrit is a trial and uses Gujarati letters. Check speech and shloks in rehearsal.
          </Notice>
        )}
        {settings.language === 'auto' && (
          <p className="text-sm text-muted">
            Choosing one language is more accurate: as heard, Gujarati is often taken for Hindi.
          </p>
        )}
        <p className="text-sm text-muted">
          Change it as the speakers change: File › Speaker’s Language does the same during the show.
        </p>
        {view.languageModels.some((m) => m.known.length > 0 || m.chosen !== null) && (
          <div className="space-y-3" data-testid="captions-language-models">
            <p className="text-sm text-muted">
              A model of its own hears its language when the speaker’s language is set to it. Drashti uses
              only a model file it knows, checked before each use.
            </p>
            {view.languageModels
              .filter((m) => m.known.length > 0 || m.chosen !== null)
              .map((m) => (
                <LanguageModelRow key={m.language} model={m} />
              ))}
          </div>
        )}
        <CaptionWordsSection listening={settings.language} />
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
        <TimingFields timing={view.timing} />
      </div>
    </Dialog>
  );
}

/** One language's own model (alpha.22): which one hears it, adding its file, and checking it again. */
function LanguageModelRow({ model }: { model: LanguageModelView }) {
  const name = LANGUAGE_NAMES[model.language];
  const checking = model.phase === 'checking';
  const unknownChosen = model.chosen !== null && !model.known.some((k) => k.id === model.chosen);
  const refused = model.message !== null && !checking && model.phase !== 'missing';
  return (
    <div
      className="space-y-1"
      data-testid={`captions-language-model-${model.language}`}
      data-phase={model.phase}
    >
      <div className="flex items-end gap-2">
        <Field label={`${name} model`} className="min-w-0 flex-1">
          <Select
            data-testid={`captions-language-model-${model.language}-choice`}
            className="w-full"
            value={model.chosen ?? ''}
            disabled={checking}
            onChange={(e) => {
              takeCaptions(
                window.drashti.captions.setLanguageModel(
                  model.language,
                  e.target.value === '' ? null : e.target.value,
                ),
              );
            }}
          >
            <option value="">The general model (above)</option>
            {model.known.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}, {megabytes(k.bytes)}
                {k.here ? '' : ' (not on this computer)'}
              </option>
            ))}
            {unknownChosen && <option value={model.chosen ?? ''}>Not known in this copy of Drashti</option>}
          </Select>
        </Field>
        <Button
          size="sm"
          data-testid={`captions-language-model-${model.language}-add`}
          disabled={checking}
          onClick={() => {
            takeCaptions(window.drashti.captions.addLanguageModel(model.language));
          }}
        >
          Add a model file…
        </Button>
      </div>
      {refused ? (
        <Notice tone="danger" data-testid={`captions-language-model-${model.language}-notice`}>
          {languageModelText(model)}{' '}
          {model.phase === 'changed' && (
            <Button
              size="sm"
              data-testid={`captions-language-model-${model.language}-check`}
              onClick={() => {
                takeCaptions(window.drashti.captions.checkLanguageModel(model.language));
              }}
            >
              Check again
            </Button>
          )}
        </Notice>
      ) : (
        <p
          className="text-sm text-muted"
          role="status"
          data-testid={`captions-language-model-${model.language}-state`}
        >
          {languageModelText(model)}
        </p>
      )}
    </div>
  );
}

/** The live timing on this computer (alpha.22), folded away until asked for: the standard choices are as before. */
function TimingFields({ timing }: { timing: CaptionTiming }) {
  const [open, setOpen] = useState(false);
  const set = (next: Partial<CaptionTiming>) => {
    takeCaptions(window.drashti.captions.setTiming({ ...timing, ...next }));
  };
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls="captions-timing"
        data-testid="captions-timing-open"
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        Timing for live use
      </Button>
      {open && (
        <div id="captions-timing" className="space-y-3" data-testid="captions-timing">
          <p className="text-sm text-muted">
            Quicker choices show words sooner but need a faster computer. Listening starts again when one
            changes. The standard choices are the timing captions have always had.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New words every">
              <Select
                data-testid="captions-timing-step"
                className="w-full"
                value={timing.stepMs}
                onChange={(e) => {
                  set({ stepMs: Number(e.target.value) as CaptionTiming['stepMs'] });
                }}
              >
                {CAPTION_STEPS_MS.map((v) => (
                  <option key={v} value={v}>
                    {STEP_NAMES[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="A phrase ends after">
              <Select
                data-testid="captions-timing-pause"
                className="w-full"
                value={timing.pauseMs}
                onChange={(e) => {
                  set({ pauseMs: Number(e.target.value) as CaptionTiming['pauseMs'] });
                }}
              >
                {CAPTION_PAUSES_MS.map((v) => (
                  <option key={v} value={v}>
                    {PAUSE_NAMES[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Longest phrase">
              <Select
                data-testid="captions-timing-longest"
                className="w-full"
                value={timing.longestMs}
                onChange={(e) => {
                  set({ longestMs: Number(e.target.value) as CaptionTiming['longestMs'] });
                }}
              >
                {CAPTION_LONGEST_MS.map((v) => (
                  <option key={v} value={v}>
                    {LONGEST_NAMES[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Speech level">
              <Select
                data-testid="captions-timing-speech"
                className="w-full"
                value={timing.speech}
                onChange={(e) => {
                  set({ speech: e.target.value as CaptionTiming['speech'] });
                }}
              >
                {CAPTION_SPEECH_LEVELS.map((v) => (
                  <option key={v} value={v}>
                    {SPEECH_LEVEL_NAMES[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Engine threads">
              <Select
                data-testid="captions-timing-threads"
                className="w-full"
                value={timing.threads}
                onChange={(e) => {
                  set({ threads: Number(e.target.value) as CaptionTiming['threads'] });
                }}
              >
                {CAPTION_THREADS.map((v) => (
                  <option key={v} value={v}>
                    {THREAD_NAMES[v]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
