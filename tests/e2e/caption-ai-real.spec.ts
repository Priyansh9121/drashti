import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { captionClips, characterErrorRate, fakeMicrophoneFile } from './caption-clips';
import { routeCInTheApp } from './route-c-in-app';

/*
 * Caption AI's REAL recogniser inside Drashti (alpha.23, cap-realc; a22-review-cap S4): Route C (AI4Bharat's
 * IndicConformer, CTC) from alpha.22's real packs, imported as an admin does (Import a Zip…), hearing generated speech
 * (cap-winci's synthetic clips: never real speech, a recording or a microphone) as the stream's sound input
 * (route-c-in-app.ts). No stand-in engine.
 *
 * The packs are fetched by CI (scripts/fetch-caption-models.mjs, cap-winci; never in git or an installer); this spec only
 * reads the fetched copy, offline, and fails (never skips) where it is not there. The parts leave it out
 * (playwright.config.ts): CI runs it in a step of its own with DRASHTI_E2E_REAL_CAPTIONS=1 (ci.yml, "End-to-end and
 * installers"). Nothing here needs today's Whisper engine: Route C is the only recogniser this test asks for.
 */

/** Silence before the first clip: the stream's frames are measured, then Route C starts listening, within it. */
const LEAD_MS = 15_000;
/** Silence after each clip, longer than the live limit: its phrase settles there, before the next clip begins. */
const GAP_MS = 4_000;
/**
 * A sanity bound on what is heard, not an accuracy measure (that is cap-eval's and cap-drive-eval's, on real speech):
 * cap-integration's in-chain run of synthetic Gujarati clips heard them at CER 0.03 median, 0.16 at most. A recogniser
 * fed the wrong rate, the wrong language or a broken sound path hears far worse.
 */
const CER_LIMIT = 0.25;

const ROUTES = [
  { language: 'gu', name: 'Gujarati', pack: 'pack-gu-indicconformer-int8', model: 'gu-indicconformer-ctc-int8' },
  { language: 'hi', name: 'Hindi', pack: 'pack-hi-indicconformer-int8', model: 'hi-indicconformer-ctc-int8' },
] as const;

/** Where CI keeps the fetched packs (ci.yml caches it; outside ~/.cache/drashti, which FFmpeg's cache saves whole). */
const PACKS = join(homedir(), '.cache', 'drashti-caption-models');

/** The pack zip CI fetched (cap-winci's script, offline: it checks the cached copy and never downloads). */
function fetchedPack(id: string): string {
  const run = spawnSync(
    process.execPath,
    ['scripts/fetch-caption-models.mjs', '--offline', '--cache', PACKS, id],
    { encoding: 'utf8' },
  );
  const line = run.stdout
    .split(/\r?\n/u)
    .find((l) => l.startsWith(`${id}=`))
    ?.slice(id.length + 1);
  if (run.status !== 0 || !line)
    throw new Error(
      `The real caption pack ${id} is not fetched on this computer: run node scripts/fetch-caption-models.mjs --cache ${PACKS} ${id} first (CI does). ${run.stderr.trim()}`,
    );
  return line;
}

for (const route of ROUTES) {
  test(`caption AI's real Route C (${route.name}): generated speech through the stream's sound input reaches the hall, the stage and the stream within the live limit, the stream's frames as before, and the pack goes only after the helper has stopped`, async () => {
    test.setTimeout(300_000);
    const zip = fetchedPack(route.pack);
    const folder = test.info().outputPath('fake-microphone');
    mkdirSync(folder, { recursive: true });
    const wav = join(folder, `${route.language}-clips.wav`);
    const sounds = fakeMicrophoneFile(wav, captionClips(route.language), { leadMs: LEAD_MS, gapMs: GAP_MS });
    await routeCInTheApp({
      name: `caption-ai-real-${route.language}`,
      language: route.language,
      model: route.model,
      pack: { kind: 'zip', path: zip },
      wav,
      sounds,
      leadMs: LEAD_MS,
      gapMs: GAP_MS,
      heard: (clip, heard) => {
        const cer = characterErrorRate(clip.text, heard);
        expect(cer, `${clip.id}: what was heard (CER)`).toBeLessThanOrEqual(CER_LIMIT);
        return { cer: Number(cer.toFixed(3)) };
      },
    });
  });
}
