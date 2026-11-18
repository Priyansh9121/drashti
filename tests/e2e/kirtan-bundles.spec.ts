import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type PageGlobals,
  dropFiles,
  importAndGetIds,
  launchApp,
  NO_PLACEHOLDERS,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';

/** Generated silent audio and placeholder words only; no internet or real library is used. */
function silentWav(): Buffer {
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16000, 40);
  return wav;
}

async function saveBundle(app: ElectronApplication, win: Page, output: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, output);
  await openLibrary(win);
  await win.getByTestId('kirtan-bundle-export').click();
  const dialog = win.getByTestId('kirtan-bundle-export-dialog');
  await expect(dialog).toBeVisible();
  await expectFits(dialog, 'Kirtan bundle export dialog');
  await expectNoSeriousA11yIssues(win, 'Kirtan bundle export dialog');
  await dialog.getByRole('checkbox', { name: 'Sample kirtan (placeholder)', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Include media files', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save bundle…', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function snapshot(win: Page, id: string) {
  return win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const [doc, tracks] = await Promise.all([d.library.getPresentation(pid), d.kirtans.tracks(pid)]);
    if (!doc || !tracks.ok) throw new Error('Missing placeholder kirtan');
    return {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      details: doc.kirtan
        ? {
            category: doc.kirtan.category,
            kavi: doc.kirtan.kavi,
            raag: doc.kirtan.raag,
            occasions: doc.kirtan.occasions,
            tracks: doc.kirtan.tracks,
          }
        : null,
      slides: tracks.slides.map((s) => ({
        lines: s.lines,
        groupName: s.groupName,
        label: s.label,
        made: s.made,
      })),
      arrangements: doc.arrangements.map((a) => ({
        name: a.name,
        groups: a.groupIds.map((id) => doc.groups.find((g) => g.id === id)?.name),
      })),
      selected: doc.arrangements.find((a) => a.id === doc.selectedArrangementId)?.name ?? null,
    };
  }, id);
}

test('a chosen kirtan exports from one library and imports into a fresh library with its tracks, details, arrangements and media; re-import updates it while the live show stays put', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'drashti-kirtan-bundle-e2e-'));
  const firstBundle = join(folder, 'Placeholder first.drashti-kirtans');
  const secondBundle = join(folder, 'Placeholder changed.drashti-kirtans');
  const wav = silentWav();
  const sound = join(folder, 'Placeholder silent.wav');
  writeFileSync(sound, wav);
  const source = await launchApp();
  const win = await operatorPage(source.app);
  await operatorReady(win);
  const [audioId] = await importAndGetIds(win, [sound]);
  const id = await win.evaluate(async (mediaId) => {
    const d = (globalThis as PageGlobals).drashti;
    const p = (await d.library.listPresentations()).find((p) => p.name === 'Sample kirtan (placeholder)');
    if (!p || !mediaId) throw new Error('Missing placeholder seed');
    const saved = await d.kirtans.setDetails(p.id, {
      category: 'Kirtan',
      kavi: 'Placeholder poet',
      raag: 'Placeholder raag',
      occasions: ['Placeholder occasion'],
      audioMediaId: mediaId,
    });
    if (!saved.ok) throw new Error(saved.message);
    return p.id;
  }, audioId ?? '');
  const expected = await snapshot(win, id);
  await saveBundle(source.app, win, firstBundle);
  await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const tracks = await d.kirtans.tracks(pid);
    if (!tracks.ok || !tracks.slides[0]) throw new Error('Missing placeholder track');
    const saved = await d.kirtans.saveTracks(pid, [
      { slideId: tracks.slides[0].slideId, lang: 'en', lines: ['Placeholder incoming bundle change'] },
    ]);
    if (!saved.ok) throw new Error(saved.message);
  }, id);
  const changed = await snapshot(win, id);
  await saveBundle(source.app, win, secondBundle);
  await source.app.close();

  const target = await launchApp(NO_PLACEHOLDERS);
  const receiving = await operatorPage(target.app);
  await operatorReady(receiving);
  expect(
    await receiving.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations()),
  ).toEqual([]);
  await openLibrary(receiving);
  await dropFiles(receiving, receiving.getByTestId('library-sheet'), [firstBundle]);
  await expect
    .poll(() =>
      receiving.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.library.listPresentations()).length,
      ),
    )
    .toBe(1);
  const receivedId = await receiving.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.library.listPresentations())[0]?.id ?? '',
  );
  expect(receivedId).not.toBe(id);
  expect(await snapshot(receiving, receivedId)).toEqual(expected);
  const media = await receiving.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const doc = await d.library.getPresentation(pid);
    return (await d.library.listMedia()).find((m) => m.id === doc?.kirtan?.audioMediaId);
  }, receivedId);
  expect(media).toMatchObject({ name: 'Placeholder silent.wav', missing: false, kind: 'audio' });
  const digest = createHash('sha256').update(wav).digest('hex');
  expect(readFileSync(join(target.userData, 'Media', digest.slice(0, 2), `${digest}.wav`))).toEqual(wav);

  await receiving.evaluate(async (pid) => {
    const result = await (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'goLive',
      presentationId: pid,
      slideIndex: 0,
    });
    if (!result.ok) throw new Error('Placeholder slide did not go live');
  }, receivedId);
  const live = () =>
    receiving.evaluate(async () => {
      const { state } = await (globalThis as PageGlobals).drashti.engine.snapshot();
      return {
        live: state.live,
        slide: state.layers.slide,
        background: state.layers.background,
        audio: state.layers.audio,
      };
    });
  const before = await live();
  const report = await receiving.evaluate(async (path) => {
    const d = (globalThis as PageGlobals).drashti;
    const imported = await d.library.importPaths([path]);
    if (!imported.ok) throw new Error(imported.message);
    return d.library.getImportReport(imported.run.id);
  }, secondBundle);
  expect(report?.items[0]).toMatchObject({
    format: 'kirtan-bundle',
    outcome: 'replaced',
    target: { id: receivedId },
  });
  expect(await snapshot(receiving, receivedId)).toEqual(changed);
  expect(await live()).toEqual(before);
  expect(
    await receiving.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.library.listPresentations()).length,
    ),
  ).toBe(1);
  await target.app.close();
});
