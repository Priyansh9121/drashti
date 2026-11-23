import { useEffect, useState } from 'react';
import {
  captionCorrectionSchema,
  type CaptionCorrection,
  type CaptionReview,
} from '../../../shared/caption-coordinator';
import { Button } from '../ui/Button';
import { Field, Textarea } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { Toggle } from '../ui/Toggle';
import { takeCaptions } from './captions-store';

/** A response to an earlier IPC read cannot resurrect an old session in the review panel. */
export function latestCaptionReview(current: CaptionReview | null, next: CaptionReview): CaptionReview {
  return current && current.version > next.version ? current : next;
}

export function CaptionPrototypeControls({
  review,
  take,
}: {
  review: CaptionReview;
  take: (review: CaptionReview | null) => void;
}) {
  const [draft, setDraft] = useState<CaptionCorrection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = review.current;
  const sameDraft =
    current !== null && draft?.sessionId === current.sessionId && draft.phraseId === current.phraseId;
  const stale = !draft || !current || !sameDraft || draft.revision !== current.revision;
  const validDraft = draft !== null && captionCorrectionSchema.safeParse(draft).success;
  const perform = (pending: Promise<CaptionReview | null>) => {
    void pending
      .then(take)
      .catch(() => setMessage('The rehearsal control could not be applied. Try it again.'));
  };
  return (
    <section
      className="space-y-3 rounded-md border border-field p-3"
      aria-label="Caption correction rehearsal"
    >
      <Toggle
        checked={review.on}
        label="Placeholder caption rehearsal (prototype)"
        data-testid="captions-prototype-on"
        onChange={(on) => {
          setDraft(null);
          setMessage(null);
          perform(window.drashti.captions.setPrototypeOn(on));
          takeCaptions(window.drashti.captions.view());
        }}
      />
      <p className="text-sm text-muted">
        Fixed English example words. No sound input or model. Normal live captions pause while this is on.
        This rehearsal does not recognize speech or translate it. Turning it off restores the live-caption
        setting.
      </p>
      {review.on && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => perform(window.drashti.captions.advancePrototype())}>
              Next placeholder update
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDraft(null);
                perform(window.drashti.captions.restartPrototype());
              }}
            >
              Restart placeholders
            </Button>
          </div>
          <p className="text-sm break-words" role="status" data-testid="captions-review-status">
            {current
              ? `${current.status === 'provisional' ? 'Provisional' : current.status === 'corrected' ? 'Corrected' : 'Settled'} — ${current.sourceText}`
              : 'Waiting for a placeholder update.'}
          </p>
          {review.canCorrect && current?.status !== 'provisional' && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (current)
                    setDraft({
                      sessionId: current.sessionId,
                      phraseId: current.phraseId,
                      revision: current.revision,
                      text: current.sourceText,
                    });
                  setMessage(null);
                }}
              >
                Correct last phrase…
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!current) return;
                  void window.drashti.captions.dismissPrototype(current).then((ok) => {
                    if (ok) setDraft(null);
                    else setMessage('That phrase has changed or left the screens.');
                  });
                }}
              >
                Dismiss phrase
              </Button>
            </div>
          )}
          {sameDraft && (
            <div className="space-y-2">
              <Field
                label="Corrected phrase"
                error={
                  stale
                    ? 'The phrase changed. Close this edit and open it again.'
                    : !validDraft
                      ? 'Use a shorter correction with plain text.'
                      : null
                }
              >
                <Textarea
                  rows={3}
                  maxLength={4_096}
                  value={draft.text}
                  onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={stale || !validDraft || !review.canCorrect}
                  onClick={() => {
                    void window.drashti.captions.correctPrototype(draft).then((ok) => {
                      if (ok) setDraft(null);
                      else
                        setMessage('The correction was not applied: the phrase changed or left the screens.');
                    });
                  }}
                >
                  Apply correction
                </Button>
                <Button size="sm" onClick={() => setDraft(null)}>
                  Close edit
                </Button>
              </div>
            </div>
          )}
          {review.previous && (
            <details className="text-sm text-muted">
              <summary>Previous phrase (review only)</summary>
              <p className="break-words">{review.previous.sourceText}</p>
            </details>
          )}
          {review.omitted > 0 && <p className="text-sm text-muted">{review.omitted} caption work omitted.</p>}
          <p className="text-xs text-muted">
            Only the current and previous phrase stay in memory. An old edit cannot replay a phrase. These
            corrections do not change the sound recording's draft or pictures already streamed.
          </p>
        </>
      )}
      {message && <Notice tone="warning">{message}</Notice>}
    </section>
  );
}

export function CaptionPrototypePanel() {
  const [review, setReview] = useState<CaptionReview | null>(null);
  const [problem, setProblem] = useState(false);
  const take = (next: CaptionReview | null) => {
    if (next && typeof next.version === 'number') setReview((current) => latestCaptionReview(current, next));
  };
  useEffect(() => {
    let live = true;
    const receive = (next: CaptionReview | null) => {
      if (live && next && typeof next.version === 'number')
        setReview((current) => latestCaptionReview(current, next));
    };
    const stop = window.drashti.captions.onPrototypeChanged(receive);
    void window.drashti.captions
      .prototypeView()
      .then(receive)
      .catch(() => {
        if (live) setProblem(true);
      });
    return () => {
      live = false;
      stop();
    };
  }, []);
  if (problem)
    return (
      <Notice tone="warning">
        The rehearsal controls could not be opened. Close Live captions and open it again.
      </Notice>
    );
  return review ? (
    <CaptionPrototypeControls key={review.sessionId ?? 'off'} review={review} take={take} />
  ) : null;
}
