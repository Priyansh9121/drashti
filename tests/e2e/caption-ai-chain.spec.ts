import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeIndicFixture } from '../../scripts/indic-fixture.mjs';
import { placeholderCaptionPack } from './caption-ai-fixtures';
import { toneBurstsFile } from './caption-clips';
import { routeCInTheApp } from './route-c-in-app';

/*
 * Route C's whole chain inside Drashti with no model downloaded (alpha.23, cap-realc; route-c-in-app.ts: the pack
 * imported, findIndic, the store's real acquire, Drashti's helper with two threads
 * below the show, the stream's sound graph, tap and port, the coordinator and three places), but the pack holds the
 * generated test graph (scripts/indic-fixture.mjs, as indic-captions.spec.ts runs it), which "hears" its one phrase in
 * whatever it is given. So the sound must decide when: the fake microphone's file holds generated tone bursts after a
 * long silence (no voice, no recording), and each burst, and nothing before them, gives one settled phrase on time.
 * A fake microphone still beeping (the file not played) is heard in the silence and fails.
 *
 * In its own CI step (DRASHTI_E2E_REAL_CAPTIONS=1, ci.yml): the parts leave it out.
 *
 * The stream page's own frames (route-c-frames.ts): the owner, 24 Nov 2026 (QA23-REALC-2), word for word: "Mac: log
 * frames only (Rec.)". On the Mac they are recorded (the run's numbers) and not judged in this release; Windows judges
 * them as before. Every other check stays on both systems: each phrase on the hall, the stage and the stream within
 * 3 s, listening before the first sound, nothing heard before it, the pack let go only after the helper. The Mac's
 * verdict returns in the next release with the stream-clock seam and more captions-off pairs.
 */

const LEAD_MS = 15_000;
/** Longer than a phrase's six seconds on the screens, so each burst's phrase, the same words, is drawn anew. */
const GAP_MS = 9_000;
/** What the generated graph always decodes to (its tokens: "▁shape", "▁box"; the repeat across a blank is kept). */
const HEARD = 'shape shape box';
/**
 * Two bursts (at 15.0 and 24.4 s, the file over by about 25 s): on CI's Mac Chromium's fake microphone falls behind
 * real time from about 35 s into its file (a third burst there reached the screens at 2.4 s; cap-realc.md), which is
 * the test device's, not Drashti's. The lead, the gap and the 3 s limit are unchanged (lead 2, from
 * cap-review-realc). Whether the stream's own sound path loses sound under heavy load stays open, for
 * s59-cap-realc-next's stream-clock test.
 */
const BURSTS = 2;

test('Route C’s whole chain in the app with the generated test model: each tone burst the stream’s sound input carries, and nothing before them, gives its phrase on the hall, the stage and the stream within the live limit; the stream’s frames as before; the pack goes only after the helper has stopped', async () => {
  test.setTimeout(240_000);
  const fixture = makeIndicFixture();
  const pack = placeholderCaptionPack({
    conformer: true,
    files: {
      model: fixture.model,
      tokens: Buffer.from(fixture.tokens),
      frontend: fixture.frontend,
    },
  });
  const folder = test.info().outputPath('fake-microphone');
  mkdirSync(folder, { recursive: true });
  const wav = join(folder, 'tone-bursts.wav');
  const sounds = toneBurstsFile(wav, {
    leadMs: LEAD_MS,
    gapMs: GAP_MS,
    bursts: BURSTS,
    burstMs: 400,
    text: HEARD,
  });
  await routeCInTheApp({
    name: 'caption-ai-chain',
    language: 'gu',
    model: 'placeholder-gu',
    env: { DRASHTI_TEST_SPEECH_MODELS: pack.list },
    pack: { kind: 'folder', path: pack.folder },
    wav,
    sounds,
    leadMs: LEAD_MS,
    gapMs: GAP_MS,
    heard: (_burst, heard) => ({ ok: heard === HEARD, numbers: { asHeard: heard === HEARD } }),
  });
});
