import { test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captionClips, characterErrorRate, fakeMicrophoneFile } from './caption-clips';
import { routeCInTheApp } from './route-c-in-app';

/*
 * Caption AI's REAL recogniser inside Drashti (alpha.23, cap-realc; a22-review-cap S4): Route C (AI4Bharat's
 * IndicConformer, CTC) from alpha.22's real packs, imported as an admin does (Import a Zip…), hearing generated speech
 * (cap-winci's synthetic clips: never real speech, a recording or a microphone) as the stream's sound input
 * (route-c-in-app.ts). No stand-in engine.
 *
 * The packs are fetched by CI (scripts/fetch-caption-models.mjs, cap-winci: the prerelease page caption-packs-2026-11-24,
 * SHA-256 pinned; never in git or an installer); this spec only reads the fetched copy, never downloading, and fails
 * (never skips) where it is not there. The parts leave it out
 * (playwright.config.ts): CI runs it in a step of its own with DRASHTI_E2E_REAL_CAPTIONS=1 (ci.yml, "End-to-end and
 * installers", runs asked by hand only: never on a push, so the release gate never downloads them). Route C is the only
 * recogniser this test asks for; until cap-next's fix, captions start only where Whisper's program is present (CI
 * fetches it), nothing else of it is used.
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
/** The first three sentences of each language, in both of cap-winci's voices (about 20 s of speech). */
const CLIPS = 6;

const ROUTES = [
  {
    language: 'gu',
    name: 'Gujarati',
    pack: 'pack-gu-indicconformer-int8',
    model: 'gu-indicconformer-ctc-int8',
  },
  { language: 'hi', name: 'Hindi', pack: 'pack-hi-indicconformer-int8', model: 'hi-indicconformer-ctc-int8' },
] as const;

/** Where CI keeps the fetched packs (ci.yml caches it; outside ~/.cache/drashti, which FFmpeg's cache saves whole). */
const PACKS = join(homedir(), '.cache', 'drashti-caption-models');

/**
 * The pack zip CI fetched, checked again by its pinned size and SHA-256 (cap-winci's fetchCaptionModel, run as an ES
 * module in a child Node: Playwright's loader cannot import that script). Read from the cache only: its fetch refuses,
 * so a test never downloads, and a pack not fetched here fails with how to fetch it.
 */
function fetchedPack(id: string): string {
  const script = pathToFileURL(join(process.cwd(), 'scripts', 'fetch-caption-models.mjs')).href;
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { fetchCaptionModel } = await import(${JSON.stringify(script)});
const [cacheDir, id] = process.argv.slice(1);
const file = await fetchCaptionModel(id, {
  cacheDir,
  fetch: () => Promise.reject(new Error('a test never downloads')),
  pause: () => Promise.resolve(),
});
process.stdout.write(file);`,
      PACKS,
      id,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0 || !run.stdout)
    throw new Error(
      `The real caption pack ${id} is not fetched on this computer: run node scripts/fetch-caption-models.mjs --cache ${PACKS} ${id} first (CI does). ${run.stderr.trim()}`,
    );
  return run.stdout;
}

for (const route of ROUTES) {
  test(`caption AI's real Route C (${route.name}): generated speech through the stream's sound input reaches the hall, the stage and the stream within the live limit, the stream's frames as before, and the pack goes only after the helper has stopped`, async () => {
    test.setTimeout(300_000);
    const zip = fetchedPack(route.pack);
    const folder = test.info().outputPath('fake-microphone');
    mkdirSync(folder, { recursive: true });
    const wav = join(folder, `${route.language}-clips.wav`);
    const clips = captionClips(route.language, CLIPS);
    const sounds = fakeMicrophoneFile(wav, clips, { leadMs: LEAD_MS, gapMs: GAP_MS });
    await routeCInTheApp({
      name: `caption-ai-real-${route.language}`,
      language: route.language,
      model: route.model,
      pack: { kind: 'zip', path: zip },
      wav,
      sounds,
      leadMs: LEAD_MS,
      gapMs: GAP_MS,
      heard: (sound, heard) => {
        const clip = clips.find((c) => c.id === sound.id);
        if (!clip) throw new Error(`No clip ${sound.id}`);
        // Against the words as written, or as they may fairly be written (a time in digits): the closer.
        const cer = Math.min(...[clip.text, ...clip.also].map((said) => characterErrorRate(said, heard)));
        return { ok: cer <= CER_LIMIT, numbers: { cer: Number(cer.toFixed(3)) } };
      },
    });
  });
}
