import { type GuideId, type IndexedGuide, passagesHolding, plainWords } from './guides';
import type { Passage } from './markdown';
import { matchesAll, searchWords } from './search';

/*
 * Curated answers in Help › Guides (Sessions 31–36): the questions a volunteer asks in the middle of a
 * sabha, each answered by one passage of a guide, shown in the guide's own words. A search lists the
 * answers holding every word typed before what the guides hold, the closest first, so an answer's own
 * words find it first. An answer is offered only where its guide can be read (Simple Mode reads the
 * operator's and the presenter's guides only).
 */

export interface GuideAnswer {
  /** "When …, what do I do?", in the guide's words as far as they go. */
  question: string;
  doc: GuideId;
  /** The words its passage starts with, as the guide writes them (resolved as "What is this?" does). */
  words: string;
}

export const GUIDE_ANSWERS: readonly GuideAnswer[] = [
  {
    question: 'When the screen shows Simple Mode and I need Pro Mode, what do I do?',
    doc: 'operator',
    words: '**Switch on and start Drashti.**',
  },
  {
    question: 'When the sabha should start with a countdown, what do I do?',
    doc: 'operator',
    words: '**A countdown for the start**',
  },
  {
    question: 'When something must be deleted, what do I do?',
    doc: 'operator',
    words: '**Deleting.**',
  },
  {
    question: 'When an editor asks “Keep your changes?”, what do I do?',
    doc: 'operator',
    words: '**Closing with changes asks first.**',
  },
  {
    question: 'When a car’s owner must be asked to move it, what do I do?',
    doc: 'operator',
    words: '**Messages.**',
  },
  {
    question: 'When the performers need a short message, what do I do?',
    doc: 'operator',
    words: '**The stage message.**',
  },
  {
    question: 'When a speaker’s name should show across the bottom, what do I do?',
    doc: 'operator',
    words: '**Lower Thirds.**',
  },
  {
    question: 'When announcements from phones are waiting, what do I do?',
    doc: 'operator',
    words: '**Announcements from phones.**',
  },
  {
    question: 'When the music must stop during the sabha, what do I do?',
    doc: 'operator',
    words: '**Music during the sabha.**',
  },
  {
    question: 'When the controls are covered by an output, what do I do?',
    doc: 'operator',
    words: '**The controls are covered by an output.**',
  },
  {
    question: 'When there is a mistake on the screens, what do I do?',
    doc: 'operator',
    words: '**A mistake on the screens.**',
  },
  {
    question: 'When a screen is black or frozen, what do I do?',
    doc: 'operator',
    words: '**A screen is black or frozen.**',
  },
  {
    question: 'When there is no sound in the hall, what do I do?',
    doc: 'operator',
    words: '**No sound in the hall.**',
  },
  {
    question: 'When there is no sound on the stream, what do I do?',
    doc: 'operator',
    words: '**No sound on the stream.**',
  },
  {
    question: 'When the stream’s picture has stopped, what do I do?',
    doc: 'operator',
    words: "**The stream's picture has stopped.**",
  },
  {
    question: 'When the stream says Reconnecting, what do I do?',
    doc: 'operator',
    words: '**The stream says Reconnecting.**',
  },
  {
    question: 'When Drashti has closed by itself, what do I do?',
    doc: 'operator',
    words: '**Drashti closed by itself.**',
  },
  {
    question: 'When anything went wrong in the sabha, what do I do?',
    doc: 'operator',
    words: 'If anything went wrong, **Help**, then **Save Diagnostics…**',
  },
  {
    question: 'When the phone says “Not connected”, what do I do?',
    doc: 'presenter',
    words: '**"Not connected"**',
  },
  {
    question: 'When the phone says “This device was removed”, what do I do?',
    doc: 'presenter',
    words: '**"This device was removed"**',
  },
  {
    question: 'When the phone’s screen goes dark during the talk, what do I do?',
    doc: 'presenter',
    words: '**The screen goes dark during the talk**',
  },
  {
    question: 'When a button on the phone says it cannot be done, what do I do?',
    doc: 'presenter',
    words: '**A button says it cannot be done**',
  },
  {
    question: 'When an update is offered on the day of a sabha, what do I do?',
    doc: 'admin',
    words: '**Never update on the day of a sabha.**',
  },
  {
    question: 'When the node refuses to follow Main after an update, what do I do?',
    doc: 'admin',
    words: '**One version on both computers.**',
  },
  {
    question: 'When the admin PIN is forgotten, what do I do?',
    doc: 'admin',
    words: '**Resetting a forgotten admin PIN.**',
  },
  {
    question: 'When a screen says Stopped, what do I do?',
    doc: 'admin',
    words: '**A screen that says Stopped.**',
  },
  {
    question: 'When a file Drashti keeps cannot be read, what do I do?',
    doc: 'admin',
    words: '**When a file Drashti keeps cannot be read**',
  },
  {
    question: 'When the stream server’s certificate could not be checked, what do I do?',
    doc: 'admin',
    words: '**The Stream panel says "The stream server\'s certificate could not be checked".**',
  },
];

/** An answer a search found, with the passage that answers it. */
export interface AnswerHit {
  answer: GuideAnswer;
  passage: Passage;
}

/**
 * The answers holding every word typed (in the question or its passage's first words), from the guides
 * given, the closest first: the fewest words beyond those typed, then in the list's order.
 */
export function searchAnswers(
  answers: readonly GuideAnswer[],
  guides: readonly IndexedGuide[],
  query: string,
): AnswerHit[] {
  const asked = searchWords(query);
  if (asked.length === 0) return [];
  const found: { hit: AnswerHit; extra: number; order: number }[] = [];
  answers.forEach((answer, order) => {
    const guide = guides.find((g) => g.id === answer.doc);
    const passage = guide && passagesHolding(guide.passages, answer.words)[0];
    if (!passage) return;
    const words = searchWords(`${answer.question} ${plainWords(answer.words)}`);
    if (!matchesAll(asked, words)) return;
    found.push({ hit: { answer, passage }, extra: words.length - asked.length, order });
  });
  return found.sort((a, b) => a.extra - b.extra || a.order - b.order).map((f) => f.hit);
}
