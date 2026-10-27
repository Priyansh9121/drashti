import { describe, expect, it } from 'vitest';
import { SaveQueue, shownValue } from './saved-setting';

/*
 * A setting the main process saves, as its boxes show it (Session 54, Session 53's question 6): a Look's layers and
 * languages, what an Events out address gets. Each box showed what was saved, and a tick changed that: a second
 * tick made before the first was saved changed what was saved before the first, and put the first back. Since the
 * review, one save at a time for each setting: during an import the main process holds each save until the import
 * gives way, each waiting on its own, so a second could be written before the first and then be overwritten by it.
 */

const HALL = 'placeholder-look:hall:layers';
const SIDE = 'placeholder-look:side:layers';

/** Saves that answer when the test says, each by what it was sent; and the settings that settled, in order. */
function saves() {
  const sent: { key: string; value: string[]; answer: (ok: boolean) => void }[] = [];
  const settled: string[] = [];
  const queue = new SaveQueue<string[]>((key) => settled.push(key));
  const save = (key: string) => (value: string[]) =>
    new Promise<boolean>((resolve) => {
      sent.push({ key, value, answer: resolve });
    });
  /** Answer the oldest save still waiting, and let what follows from it run. */
  const answer = async (ok = true) => {
    const next = sent.find((s) => s.answer !== done);
    if (!next) throw new Error('no save is waiting');
    next.answer(ok);
    next.answer = done;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { queue, save, sent, settled, answer };
}
const done = () => undefined;

describe('a setting the main process saves, as its boxes show it', () => {
  it('shows the latest change while one is on its way or waiting, and what was saved otherwise', () => {
    expect(shownValue(['background', 'slide'], null, HALL)).toEqual(['background', 'slide']);
    expect(shownValue(['background', 'slide'], { key: HALL, value: ['slide'] }, HALL)).toEqual(['slide']);
    // Another setting's change (another group, or the same group in another Look) is never shown as this one's.
    expect(shownValue(['background', 'slide'], { key: SIDE, value: ['slide'] }, HALL)).toEqual([
      'background',
      'slide',
    ]);
  });

  it('sends one save at a time for a setting: a change made while one is on its way waits, only the latest, until it has answered', async () => {
    const { queue, save, sent, settled, answer } = saves();
    queue.save(HALL, ['slide', 'messages'], save(HALL));
    queue.save(HALL, ['slide'], save(HALL));
    queue.save(HALL, [], save(HALL));
    // Only the first is on its way; the latest waits (the one between is never sent).
    expect(sent.map((s) => s.value)).toEqual([['slide', 'messages']]);
    await answer();
    expect(sent.map((s) => s.value)).toEqual([['slide', 'messages'], []]);
    expect(settled).toEqual([]);
    // Once the latest has answered, what was saved is shown again.
    await answer();
    expect(settled).toEqual([HALL]);
  });

  it('settles after a save the main process refused, as after one it kept, sending what waited first', async () => {
    const { queue, save, sent, settled, answer } = saves();
    queue.save(HALL, ['slide'], save(HALL));
    await answer(false);
    expect(settled).toEqual([HALL]);
    // Refused with another waiting: that one goes, then it settles.
    queue.save(HALL, ['messages'], save(HALL));
    queue.save(HALL, ['slide', 'messages'], save(HALL));
    await answer(false);
    expect(sent.map((s) => s.value)).toEqual([['slide'], ['messages'], ['slide', 'messages']]);
    expect(settled).toEqual([HALL]);
    await answer();
    expect(settled).toEqual([HALL, HALL]);
  });

  it('saves another setting at once, beside one on its way', async () => {
    const { queue, save, sent, settled, answer } = saves();
    queue.save(HALL, ['slide'], save(HALL));
    queue.save(SIDE, ['background'], save(SIDE));
    expect(sent.map((s) => s.key)).toEqual([HALL, SIDE]);
    await answer();
    await answer();
    expect(settled).toEqual([HALL, SIDE]);
  });
});
