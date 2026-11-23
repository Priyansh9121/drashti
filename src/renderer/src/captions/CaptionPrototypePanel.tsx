import { useEffect, useState } from 'react';
import {
  captionCorrectionSchema,
  type CaptionCorrection,
  type CaptionReview,
} from '../../../shared/caption-coordinator';
import { Button } from '../ui/Button';
import { Field, Textarea } from '../ui/Field';
import { Notice } from '../ui/Notice';

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
  // Only while a language with a model of its own is heard (caption AI): nothing of an ended session is shown.
  if (!review.on) return null;
  return (
    <section className="space-y-3 rounded-md border border-field p-3" aria-label="Caption corrections">
      <p className="text-sm text-muted">
        The phrase on the screens now. Correct it or take it off; the next phrase replaces it.
      </p>
      <p className="text-sm break-words" role="status" data-testid="captions-review-status">
        {current
          ? `${current.status === 'provisional' ? 'Provisional' : current.status === 'corrected' ? 'Corrected' : 'Settled'} — ${current.sourceText}`
          : 'Waiting for the speaker’s next words.'}
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
                  if (ok) {
                    setDraft(null);
                    // The review as it is now (the corrected phrase), without waiting for the next change.
                    void window.drashti.captions.prototypeView().then(take);
                  } else
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
        The caption corrections could not be opened. Close Live captions and open it again.
      </Notice>
    );
  return review ? (
    <CaptionPrototypeControls key={review.sessionId ?? 'off'} review={review} take={take} />
  ) : null;
}
