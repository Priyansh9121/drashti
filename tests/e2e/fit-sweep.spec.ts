import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeholderComputer } from '../access-core';
import { each, OWNERS_WINDOW, smallestContent, sweep, type Size } from './fit-sweep';
import { networkOn } from './devices';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  editorGroup,
  importAndGetIds,
  launchApp,
  lockPage,
  onEditorSlide,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
  setUpScreen,
  showExtras,
  slideEditorWindow,
  windowShowing,
} from './helpers';
import { releaseServer } from './release-server';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';
import { CI_WINDOW } from './window-size';

/*
 * The whole-app fit pass, part 2 (alpha.21, the owner's "dont like the design here. frontend issue." then "all good fit
 * in 21", 22 Nov 2026): every window and dialog but the operator window's own columns (a21-fit1's), each at its window's
 * least, at CI's 1024 × 645 and at the owner's 1410 × 900, with long placeholder names: nothing cut, over another,
 * out of its box or of the window, nothing scrolling sideways, every target 24 px or with the room round it. Each
 * finding is said by name (fit-sweep.ts), so one run lists them all. Placeholder names, links and Gmails only.
 */

const OPERATOR = 'index.html';

const LONG_PLAYLIST =
  'Placeholder evening sabha playlist with a long name for the hall, the stream and the phones';
const LONG_WORDS =
  'Placeholder નમૂના kirtan words with a long name for the library, the playlists and the editor';
const LONG_PICTURE = 'Placeholder darshan picture with a long file name for the library and the wallpapers';
const LONG_VIDEO = 'Placeholder sabha video with a long file name for Edit Video and Media information';
const LONG_LINK =
  'https://example.org/placeholder/a-long-link-for-the-sabha-hall-screens-the-stream-and-the-phones?words=many';
const LONG_GROUP = 'Placeholder hall screens with a long name for the projector and the side screens';
const LONG_GMAIL = 'placeholder.person.with.a.long.name.for.the.access.list@example.com';

/** The long-named words and picture, in a long-named playlist; their library ids. */
async function longShow(win: Page): Promise<{ wordsId: string; pictureId: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-fit-'));
  const words = join(dir, `${LONG_WORDS}.txt`);
  writeFileSync(words, 'Placeholder line one\nનમૂના પંક્તિ\n\nPlaceholder line two\n');
  const picture = await makeTestImage(win, join(dir, `${LONG_PICTURE}.png`), {
    width: 320,
    height: 180,
    color: '#1d4e89',
  });
  await importAndGetIds(win, [words, picture]);
  return win.evaluate(
    async ({ playlist, wordsName, pictureName }) => {
      const d = (globalThis as PageGlobals).drashti;
      // By name, as the placeholder show finds its own.
      const wordsId = (await d.library.listPresentations()).find((p) => p.name === wordsName)?.id ?? '';
      const pictureId = (await d.library.listMedia()).find((m) => m.name.startsWith(pictureName))?.id ?? '';
      if (!wordsId || !pictureId) throw new Error('the long-named words or picture did not come in');
      const made = await d.playlists.create(playlist, null, false);
      if (!made.ok) throw new Error(made.message);
      const added = await d.playlists.addItems(made.ids[0] ?? '', null, [
        { kind: 'presentation', presentationId: wordsId },
        { kind: 'media', mediaId: pictureId },
      ]);
      if (!added.ok) throw new Error(added.message);
      return { wordsId, pictureId };
    },
    { playlist: LONG_PLAYLIST, wordsName: LONG_WORDS, pictureName: LONG_PICTURE },
  );
}

/** A dialog closed with Esc, as the operator would. */
async function byEscape(win: Page, root: Locator): Promise<void> {
  await win.keyboard.press('Escape');
  await expect(root).toBeHidden();
}

/** The operator window's sweep: a dialog opened by `open`, swept at each size, then closed. */
function operatorSweep(app: ElectronApplication, win: Page, sizes: readonly Size[]) {
  return (what: string, root: Locator, open: () => Promise<void>, close = () => byEscape(win, root)) =>
    each(win, what, async () => {
      await open();
      await sweep(app, win, OPERATOR, root, what, sizes);
      await close();
    });
}

test('the operator window’s dialogs and sheets, each at the window’s least, at CI’s 1024 × 645 and at the owner’s 1410 × 900, with long placeholder names: nothing cut, over another or out of its box, nothing sideways, every target 24 px', async () => {
  test.setTimeout(900_000);
  // The screens as windows of their own, so a screen set up never covers the operator window.
  const { app } = await launchApp({ DRASHTI_TEST_FAKE_DEVICES: '1', DRASHTI_WINDOWED_OUTPUTS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const sizes = [await smallestContent(app, OPERATOR), CI_WINDOW, OWNERS_WINDOW];
    const { pictureId } = await longShow(win);
    // A screen with a long name on the first display, so Screens shows its group and its screen.
    await setUpScreen(win, LONG_GROUP, 0);
    const dialog = operatorSweep(app, win, sizes);
    const menu = (id: string) => () => chooseMenuItem(app, id);

    // Help.
    const manual = win.getByTestId('manual');
    await dialog('Help › Drashti Manual…', manual, menu('manual'), () => Promise.resolve());
    await dialog('Help › Drashti Manual…, a search', manual, async () => {
      await manual.getByRole('searchbox', { name: 'Search the manual' }).fill('screens');
      await expect(manual.getByTestId('manual-results')).toBeVisible();
    });
    const guides = win.getByTestId('guides');
    for (const tab of ['operator', 'presenter', 'admin', 'setup-day'])
      await dialog(
        `Help › Guides…, ${tab}`,
        guides,
        async () => {
          if ((await guides.count()) === 0) await chooseMenuItem(app, 'guides');
          await guides.getByTestId(`guides-tab-${tab}`).click();
          await expect(guides.getByTestId(`guides-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
        },
        async () => {
          if (tab === 'setup-day') await byEscape(win, guides);
        },
      );
    await dialog('Help › Keyboard Shortcuts…', win.getByTestId('keys-sheet'), menu('keyboard-shortcuts'));

    // File, Tools and View: each with long words where it takes some.
    const link = win.getByTestId('link-paste');
    await dialog('File › Import from a Link…, a link it does not take', link, async () => {
      await chooseMenuItem(app, 'import-from-link');
      await link.getByRole('textbox', { name: 'YouTube or Dropbox link' }).fill(LONG_LINK);
    });
    const qr = win.getByTestId('qr-dialog');
    await dialog('Tools › QR code…, a long link', qr, async () => {
      await chooseMenuItem(app, 'tools-qr-code');
      await qr.getByRole('textbox', { name: 'Link or words' }).fill(LONG_LINK);
      await expect(qr.getByTestId('qr-code')).toBeVisible();
    });
    const streamLink = win.getByTestId('stream-link-dialog');
    await dialog('Tools › Show a Stream Link…, a long link', streamLink, async () => {
      await chooseMenuItem(app, 'tools-show-a-stream-link');
      await streamLink.getByTestId('stream-link-text').fill(`${LONG_LINK}/placeholder.m3u8`);
    });
    await dialog(
      'Tools › Picture in Picture…',
      win.getByTestId('pip-dialog'),
      menu('tools-picture-in-picture'),
    );
    await dialog(
      'Tools › Add a Video Input…',
      win.getByTestId('video-input-dialog'),
      menu('tools-add-video-input'),
    );
    await dialog('Tools › MIDI Controller…', win.getByTestId('midi-dialog'), menu('tools-midi'));
    await dialog('Tools › OSC Control…', win.getByTestId('osc-dialog'), menu('tools-osc'));
    await dialog('File › Opening…', win.getByTestId('opening-dialog'), menu('opening'));
    await dialog('File › Drop Folder…', win.getByTestId('drop-dialog'), menu('drop-folder'));
    await dialog('File › Events Out…', win.getByTestId('events-dialog'), menu('events-out'));
    await dialog('File › Scheduled Backups…', win.getByTestId('backups-dialog'), menu('scheduled-backups'));
    await dialog('View › Appearance…', win.getByTestId('appearance-dialog'), menu('appearance-window'));

    // The sheets along the right: the Stream panel and its settings, Screens, and Phones and tablets.
    const stream = win.getByTestId('stream-panel');
    await dialog(
      'the Stream panel',
      stream,
      () => win.getByTestId('open-stream').click(),
      async () => {
        const settings = win.getByTestId('stream-settings');
        await dialog('the Stream panel’s Settings', settings, () =>
          win.getByTestId('open-stream-settings').click(),
        );
        await byEscape(win, stream);
      },
    );
    await dialog('Screens', win.getByRole('dialog', { name: 'Screens', exact: true }), () =>
      win.getByRole('button', { name: 'Screens', exact: true }).click(),
    );
    const phones = win.getByTestId('network-panel');
    await dialog(
      'Phones and tablets',
      phones,
      () => win.getByTestId('open-network').click(),
      () => Promise.resolve(),
    );
    // On, with a long-named phone being paired: its address, the code and the QR code.
    await dialog('Phones and tablets, pairing a phone', phones, async () => {
      await networkOn(win);
      await phones.getByTestId('pair-name').fill('Placeholder phone with a long name for the stage');
      await phones.getByTestId('pair-remote').click();
      await expect(phones.getByTestId('pairing-offer')).toBeVisible();
    });

    // The library's dialogs, for the long-named words and picture (each in the long-named playlist).
    const sheet = await openLibrary(win);
    const words = win.getByTestId('words-editor');
    await dialog(
      'the library’s New… (from words), long words typed',
      words,
      async () => {
        await sheet.getByRole('button', { name: 'New…' }).click();
        await win.getByTestId('words-text').fill(`${LONG_WORDS}\n\n${LONG_LINK}`);
      },
      async () => {
        await win.keyboard.press('Escape');
        const keep = win.getByTestId('keep-changes');
        await dialog(
          'Keep your changes? (the words editor)',
          keep,
          () => expect(keep).toBeVisible(),
          () => keep.getByRole('button', { name: 'Throw them away' }).click(),
        );
        await expect(words).toBeHidden();
      },
    );
    await dialog('the library’s Export kirtan bundle…', win.getByTestId('kirtan-bundle-export-dialog'), () =>
      win.getByTestId('kirtan-bundle-export').click(),
    );
    const removeConfirm = win.getByTestId('remove-confirm');
    const cancel = (root: Locator) => async () => {
      await root.getByRole('button', { name: 'Cancel' }).click();
      await expect(root).toBeHidden();
    };
    await dialog(
      'Delete a presentation in a playlist? (a long name)',
      removeConfirm,
      async () => {
        await sheet.getByTestId('library-tab-presentations').click();
        await sheet.getByTestId('presentation-row').filter({ hasText: LONG_WORDS }).click();
        await win.getByRole('button', { name: `Delete “${LONG_WORDS}”`, exact: true }).click();
      },
      cancel(removeConfirm),
    );
    await sheet.getByTestId('library-tab-media').click();
    const pictureRow = sheet.getByTestId('media-item').filter({ hasText: LONG_PICTURE });
    const mediaConfirm = win.getByTestId('media-remove-confirm');
    await dialog(
      'Delete a picture in a playlist? (a long name)',
      mediaConfirm,
      async () => {
        await pictureRow.click();
        await win.getByRole('button', { name: `Delete “${LONG_PICTURE}.png”`, exact: true }).click();
      },
      cancel(mediaConfirm),
    );
    const fileTool = (name: string) => async () => {
      await pictureRow.click({ button: 'right' });
      await win.getByRole('menuitem', { name, exact: true }).click();
    };
    await dialog('a picture’s Rename… (a long name)', win.getByTestId('rename-dialog'), fileTool('Rename…'));
    await closeLibrary(win);

    // A wallpaper of the long-named picture, the one in use (so Delete… asks first): its editor, Rename… and Delete….
    await win.evaluate(async (id) => {
      const d = (globalThis as PageGlobals).drashti;
      const added = await d.wallpapers.add([id], null);
      if (!added.ok) throw new Error(added.message);
      const chosen = await d.wallpapers.choose(added.ids[0] ?? '');
      if (!chosen.ok) throw new Error(chosen.message);
    }, pictureId);
    const tile = win
      .getByTestId('wallpapers')
      .getByTestId('wallpaper-tile')
      .filter({ hasText: LONG_PICTURE });
    const tileTool = (name: string) => async () => {
      await tile.click({ button: 'right' });
      await win.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
    };
    await dialog(
      'a wallpaper’s Edit wallpaper… (a long name)',
      win.getByTestId('wallpaper-editor'),
      tileTool('Edit wallpaper…'),
    );
    await dialog(
      'a wallpaper’s Rename… (a long name)',
      win.getByTestId('rename-dialog'),
      tileTool('Rename…'),
    );
    const wallpaperConfirm = win.getByTestId('wallpaper-delete-confirm');
    await dialog(
      'Delete a wallpaper? (a long name)',
      wallpaperConfirm,
      tileTool('Delete…'),
      cancel(wallpaperConfirm),
    );

    // Delete the long-named playlist? asked first.
    await dialog(
      'Delete a playlist? (a long name)',
      removeConfirm,
      async () => {
        const panel = win.getByTestId('playlists');
        await panel.getByTestId('playlist-node').filter({ hasText: LONG_PLAYLIST }).click();
        await panel.getByRole('button', { name: `Delete playlist “${LONG_PLAYLIST}”`, exact: true }).click();
      },
      cancel(removeConfirm),
    );
  } finally {
    await app.close();
  }
});

/** A generated video (red then blue, a tone) under `name`, made by the bundled FFmpeg. */
function placeholderVideo(dir: string, name: string): string {
  const file = join(dir, `${name}.mp4`);
  const made = spawnSync(testFfmpeg() ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-f',
    'lavfi',
    '-i',
    'color=red:s=320x180:r=25:d=4',
    '-f',
    'lavfi',
    '-i',
    'color=blue:s=320x180:r=25:d=4',
    '-f',
    'lavfi',
    '-i',
    'sine=f=120:r=8000:d=8',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-threads',
    '1',
    file,
  ]);
  expect(made.status, 'the bundled FFmpeg made the placeholder video').toBe(0);
  return file;
}

test('Edit Video…, a video’s Media information… and Sound and picture…, each at the window’s least, at CI’s 1024 × 645 and at the owner’s 1410 × 900, a long file name: nothing cut, over another or out of its box', async () => {
  test.setTimeout(600_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const sizes = [await smallestContent(app, OPERATOR), CI_WINDOW, OWNERS_WINDOW];
    const file = placeholderVideo(mkdtempSync(join(tmpdir(), 'drashti-fit-video-')), LONG_VIDEO);
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    expect(mediaId, 'the long-named video came in').not.toBe('');
    const sheet = await openLibrary(win);
    await sheet.getByTestId('library-tab-media').click();
    const row = sheet.getByTestId('media-item').filter({ hasText: LONG_VIDEO });
    const fileTool = (name: string) => async () => {
      await row.click({ button: 'right' });
      await win.getByRole('menuitem', { name, exact: true }).click();
    };
    const dialog = operatorSweep(app, win, sizes);
    const editor = win.getByTestId('edit-video');
    await dialog(
      'Edit Video…, Trim',
      editor,
      async () => {
        await fileTool('Edit Video…')();
        await expect(editor.getByTestId('timeline-waveform')).toBeVisible();
        await editor.getByRole('button', { name: 'Trim', exact: true }).click();
      },
      () => Promise.resolve(),
    );
    for (const section of ['Picture', 'Preparation and export'])
      await dialog(
        `Edit Video…, ${section}`,
        editor,
        async () => {
          await editor.getByRole('button', { name: section, exact: true }).click();
        },
        async () => {
          if (section === 'Preparation and export') await byEscape(win, editor);
        },
      );
    await dialog(
      'a video’s Media information…',
      win.getByTestId('media-info'),
      fileTool('Media information…'),
    );
    await dialog(
      'a video’s Sound and picture…',
      win.getByTestId('sound-picture'),
      fileTool('Sound and picture…'),
    );
  } finally {
    await app.close();
  }
});

test('the slide editor’s window, each of its groups along the top, at its least, at CI’s 1024 × 645 and at the owner’s 1410 × 900, a long name: nothing cut, over another or out of its box', async () => {
  test.setTimeout(600_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await longShow(win);
    // Edit slides on the library's long-named words, as the operator opens it.
    const sheet = await openLibrary(win);
    await sheet.getByTestId('presentation-row').filter({ hasText: LONG_WORDS }).click();
    await win.getByTestId('edit-slides').click();
    const { ed, editor } = await slideEditorWindow(app);
    const sizes = [await smallestContent(app, 'slide-editor.html'), CI_WINDOW, OWNERS_WINDOW];
    // The words chosen, so their settings show at the side.
    const at = await onEditorSlide(ed, 960, 540);
    await ed.mouse.click(at.x, at.y);
    for (const group of ['Words', 'Insert', 'Arrange', 'Design', 'Motion', 'Slides'])
      await each(ed, `the slide editor, ${group}`, async () => {
        await editorGroup(ed, group);
        await sweep(app, ed, 'slide-editor.html', editor, `the slide editor, ${group}`, sizes);
      });
    // Its dialogs: the slide's size, a table, a picture or video, and the presenter's notes.
    for (const [group, button, testId, what] of [
      ['Design', 'design-size', 'slide-size-dialog', 'the slide editor’s Slide size…'],
      ['Insert', 'add-table', 'insert-table', 'the slide editor’s Table…'],
      ['Insert', 'add-media', 'media-picker', 'the slide editor’s Picture or video…'],
      ['Slides', 'slides-notes', 'slides-notes-dialog', 'the slide editor’s Notes…'],
    ] as const)
      await each(ed, what, async () => {
        await editorGroup(ed, group);
        await editor.getByTestId(button).click();
        const root = ed.getByTestId(testId);
        await sweep(app, ed, 'slide-editor.html', root, what, sizes);
        await byEscape(ed, root);
      });
  } finally {
    await app.close();
  }
});

test('the first start: the welcome and each step of the setup wizard, at the window’s least, at CI’s 1024 × 645 and at the owner’s 1410 × 900: nothing cut, over another or out of its box', async () => {
  test.setTimeout(600_000);
  const { app } = await launchApp({
    DRASHTI_TEST_NO_WIZARD: '0',
    DRASHTI_TEST_SEED_PLACEHOLDERS: '',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  try {
    const win = await operatorPage(app);
    const welcome = win.getByTestId('welcome');
    await expect(welcome).toBeVisible();
    const sizes = [await smallestContent(app, OPERATOR), CI_WINDOW, OWNERS_WINDOW];
    await each(win, 'the welcome', () => sweep(app, win, OPERATOR, welcome, 'the welcome', sizes));
    const wizard = win.getByTestId('setup-wizard');
    await each(win, 'the setup wizard, Screens', async () => {
      await welcome.getByRole('button', { name: 'Set Up Screens…' }).click();
      await expect(wizard.getByTestId('setup-step')).toHaveText('Screens');
      // Each display showing the audience in some languages: the step at its longest.
      for (const display of await wizard.getByTestId('setup-display').all()) {
        await display.getByTestId('setup-use-audience').click();
        await display.getByTestId('languages-some').check();
      }
      await sweep(app, win, OPERATOR, wizard, 'the setup wizard, Screens', sizes);
    });
    for (const step of ['Sound', 'Stream', 'Finish'])
      await each(win, `the setup wizard, ${step}`, async () => {
        await wizard.getByTestId('setup-next').click();
        await expect(wizard.getByTestId('setup-step')).toHaveText(step);
        await sweep(app, win, OPERATOR, wizard, `the setup wizard, ${step}`, sizes);
      });
  } finally {
    await app.close();
  }
});

test('the Access List’s window and its dialogs, at its least, at CI’s 1024 × 645 and at the owner’s 1410 × 900, a long Gmail and computer name: nothing cut, over another or out of its box', async () => {
  test.setTimeout(600_000);
  const { app, access } = await launchApp({}, undefined, { as: 'owner' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    access.grant(
      LONG_GMAIL,
      placeholderComputer('fit-sweep-long', 'Placeholder hall computer with a long name'),
    );
    await chooseMenuItem(app, 'access-list');
    const list = await windowShowing(app, (p) => p.url().includes('access-list.html'), 'the Access List');
    await expect(list.getByTestId('access-table')).toBeVisible({ timeout: 30_000 });
    await expect(list.locator(`[data-testid="access-row"][data-gmail="${LONG_GMAIL}"]`)).toBeVisible();
    const sizes = [await smallestContent(app, 'access-list.html'), CI_WINDOW, OWNERS_WINDOW];
    const page = list.locator('body');
    await each(list, 'the Access List', () =>
      // Its table scrolls both ways inside itself, by design (design.md §51).
      sweep(app, list, 'access-list.html', page, 'the Access List', sizes, ['access-table']),
    );
    const add = list.getByTestId('access-add-dialog');
    await each(list, 'the Access List’s Add a Gmail…, a long Gmail typed', async () => {
      await list.getByTestId('access-add-open').click();
      await list.getByTestId('access-add-gmail').fill(LONG_GMAIL.replace('placeholder', 'another'));
      await list.getByTestId('access-add-name').fill('Placeholder person with a long name for the list');
      await sweep(app, list, 'access-list.html', add, 'the Access List’s Add a Gmail…', sizes);
      await byEscape(list, add);
    });
    const length = list.getByTestId('access-length-dialog');
    await each(list, 'the Access List’s Change the length…, days typed', async () => {
      await list.getByTestId('access-search').fill(LONG_GMAIL);
      await list.locator(`[data-testid="access-row"][data-gmail="${LONG_GMAIL}"] th button`).click();
      await expect(list.getByTestId('access-chosen-gmail')).toHaveText(LONG_GMAIL);
      await list.getByTestId('access-length').click();
      await list.getByTestId('access-length-choice').selectOption('typed');
      await sweep(app, list, 'access-list.html', length, 'the Access List’s Change the length…', sizes);
      await length.getByRole('button', { name: 'Cancel' }).click();
      await expect(length).toHaveCount(0);
    });
  } finally {
    await app.close();
  }
});

test('the lock window, Request Access and I Have a Token, at its least, at CI’s 1024 × 645 and at the owner’s 1410 × 900, a long Gmail typed: nothing cut, over another or out of its box', async () => {
  test.setTimeout(300_000);
  const { app } = await launchApp({}, undefined, { as: 'locked' });
  try {
    const lock = await lockPage(app);
    await expect(lock.getByTestId('access-lock')).toHaveAttribute('data-phase', 'locked');
    const sizes = [await smallestContent(app, 'lock.html'), CI_WINDOW, OWNERS_WINDOW];
    const page = lock.locator('body');
    await each(lock, 'the lock window, Request Access', async () => {
      await lock.getByTestId('access-gmail').fill(LONG_GMAIL);
      await lock.getByTestId('access-name').fill('Placeholder person with a long name for the list');
      await sweep(app, lock, 'lock.html', page, 'the lock window, Request Access', sizes);
    });
    await each(lock, 'the lock window, I Have a Token', async () => {
      await lock.getByTestId('access-tab-token').click();
      await lock.getByTestId('access-gmail').fill(LONG_GMAIL);
      await sweep(app, lock, 'lock.html', page, 'the lock window, I Have a Token', sizes);
    });
  } finally {
    await app.close();
  }
});

test('the rarer windows and dialogs (Ready?, stage layouts and a template, Show a Window…, Updates, templates and a slot, timers, Books, Music, the Lower Thirds studio and the window for Zoom), each at its window’s least, at CI’s 1024 × 645 and at the owner’s 1410 × 900: nothing cut, over another or out of its box', async () => {
  test.setTimeout(900_000);
  const release = await releaseServer({ '9.9.9': randomBytes(64 * 1024) }, '9.9.9');
  const { app } = await launchApp({
    DRASHTI_TEST_FAKE_DEVICES: '1',
    DRASHTI_UPDATE_URL: release.base,
    DRASHTI_TEST_UPDATE_INSTALL: join(mkdtempSync(join(tmpdir(), 'drashti-fit-update-')), 'install.json'),
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Templates, a template's slot and the Books show only with View › Show Books, Templates and Kirtan Details.
    await showExtras(win);
    const sizes = [await smallestContent(app, OPERATOR), CI_WINDOW, OWNERS_WINDOW];
    const { wordsId } = await longShow(win);
    // The most a stage layout's name takes is 60 letters.
    const longLayout = 'Placeholder stage layout with a long name for the stage';
    // A timer, and a stage screens' group (whose settings in Screens lead to the stage layouts); the long-named words a
    // dhun with long details (so the template's Dhun slot, the slot filled below, offers them), and a long-named stage
    // layout with long words in a box.
    await win.evaluate(
      async ({ wordsId, longLayout }) => {
        const d = (globalThis as PageGlobals).drashti;
        const details = await d.kirtans.setDetails(wordsId, {
          category: 'Dhun',
          kavi: 'Placeholder kavi with a long name for the slot',
          raag: 'Placeholder raag with a long name',
          occasions: [],
          audioMediaId: null,
        });
        if (!details.ok) throw new Error(details.message);
        const layout = await d.stageLayouts.save(null, {
          name: longLayout,
          background: '#000000',
          boxes: [
            {
              id: 'words',
              kind: 'text',
              frame: { x: 48, y: 48, width: 1824, height: 300 },
              size: 56,
              color: '#ffffff',
              align: 'left',
              label: '',
              text: 'Placeholder words for the stage with a long line for the singers and the players',
            },
          ],
        });
        if (!layout.ok) throw new Error(layout.message);
        const created = await d.screens.createGroup(
          'Placeholder stage with a long name for the stage screens',
        );
        if (!created.ok) throw new Error(created.message);
        const stage = created.snapshot.groups.find((g) => g.name.startsWith('Placeholder stage'));
        const set = await d.screens.setGroupRole(stage?.id ?? '', 'stage');
        if (!set.ok) throw new Error(set.message);
        const made = await d.timers.create({
          name: 'Placeholder countdown with a long name for the audience and the stage',
          kind: 'countdown',
          durationMs: 300_000,
          targetTime: null,
          allowsOverrun: false,
        });
        if (!made.ok) throw new Error(made.message);
      },
      { wordsId, longLayout },
    );
    const dialog = operatorSweep(app, win, sizes);
    const menu = (id: string) => () => chooseMenuItem(app, id);
    const cancel = (root: Locator) => async () => {
      await root.getByRole('button', { name: 'Cancel' }).click();
      await expect(root).toBeHidden();
    };

    await dialog('Ready?', win.getByTestId('ready-dialog'), () => win.getByTestId('open-ready').click());
    await dialog('Help › Check for Updates…', win.getByTestId('updates-dialog'), menu('check-for-updates'));
    await dialog('Tools › Show a Window…', win.getByTestId('window-picker'), menu('tools-show-a-window'));

    // Screens › Edit stage layouts…, and New from a Template… in it.
    const screens = win.getByRole('dialog', { name: 'Screens', exact: true });
    const layouts = win.getByTestId('stage-layout-editor');
    await dialog(
      'Screens › the stage layouts',
      layouts,
      async () => {
        await win.getByRole('button', { name: 'Screens', exact: true }).click();
        await screens.getByTestId('edit-stage-layouts').click();
      },
      async () => {
        // The long-named layout shown: its name in the list, its boxes and their words at the side.
        await dialog(
          'Screens › the stage layouts, a long-named layout',
          layouts,
          () => layouts.getByRole('button', { name: longLayout, exact: true }).click(),
          () => Promise.resolve(),
        );
        const template = win.getByTestId('stage-template-dialog');
        await dialog('the stage layouts’ New from a Template…', template, () =>
          layouts.getByTestId('stage-layout-from-template').click(),
        );
        await byEscape(win, layouts);
        await byEscape(win, screens);
      },
    );

    // A timer's look for the audience.
    await openSection(win, 'timers');
    await dialog('a timer’s How it looks for the audience…', win.getByTestId('timer-look'), () =>
      win
        .getByTestId('timers')
        .getByTestId('timer-row')
        .first()
        .getByRole('button', { name: 'How it looks for the audience…' })
        .click(),
    );

    // The long-named playlist's words: Timers when it goes up….
    const panel = win.getByTestId('playlists');
    await panel.getByTestId('playlist-node').filter({ hasText: LONG_PLAYLIST }).click();
    const cues = win.getByTestId('timer-cues');
    await dialog(
      'a playlist item’s Timers when it goes up… (a long name)',
      cues,
      async () => {
        await win.getByTestId('playlist-item').filter({ hasText: LONG_WORDS }).click({ button: 'right' });
        await win.getByRole('menuitem', { name: 'Timers when it goes up…' }).click();
        await cues.getByTestId('add-timer-cue').click();
      },
      cancel(cues),
    );
    // Save as template…, then a playlist from a template and a slot to fill.
    const save = win.getByTestId('save-template');
    await dialog('a playlist’s Save as template… (a long name)', save, async () => {
      await win.getByRole('button', { name: 'Playlist actions' }).click();
      await win.getByRole('menuitem', { name: 'Save as template…' }).click();
    });
    const fill = win.getByTestId('fill-slot');
    await dialog(
      'a template’s slot to fill',
      fill,
      async () => {
        await win.getByTestId('playlist-view-tab-templates').click();
        await win.getByRole('button', { name: 'New playlist from Example: Ravi Sabha' }).click();
        await win.getByRole('textbox', { name: 'Playlist name' }).press('Enter');
        await win.getByTestId('playlist-item').nth(1).click();
      },
      cancel(fill),
    );

    // The library's Books: the loaded texts.
    const sheet = await openLibrary(win);
    await dialog('the library’s Books, its texts', win.getByTestId('shastra-texts-dialog'), async () => {
      await sheet.getByTestId('library-tab-shastra').click();
      await win.getByTestId('shastra-panel').getByTestId('open-shastra-texts').click();
    });
    await closeLibrary(win);

    // Music: a new audio playlist's Add sounds….
    await openSection(win, 'audio');
    await dialog('Music’s Add sounds…', win.getByTestId('music-add-dialog'), async () => {
      await win.getByTestId('audio-add').click();
      await win.getByRole('menuitem', { name: 'Create playlist' }).click();
      await win.getByRole('textbox', { name: 'Name of the audio playlist' }).press('Enter');
      await win.getByTestId('music-panel').getByTestId('music-add').click();
    });

    // The Lower Thirds studio's window, its first tab and its templates.
    await chooseMenuItem(app, 'tools-lower-thirds-studio');
    const studio = await windowShowing(
      app,
      (p) => p.url().includes('lower-thirds.html'),
      'the Lower Thirds studio',
    );
    await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
    const studioSizes = [await smallestContent(app, 'lower-thirds.html'), CI_WINDOW, OWNERS_WINDOW];
    await each(studio, 'the Lower Thirds studio', () =>
      sweep(app, studio, 'lower-thirds.html', studio.locator('body'), 'the Lower Thirds studio', studioSizes),
    );
    await each(studio, 'the Lower Thirds studio, Templates', async () => {
      await studio.getByTestId('studio-templates').click();
      // The templates' own dialog, over the studio (the studio under its dim is swept above).
      await sweep(
        app,
        studio,
        'lower-thirds.html',
        studio.getByRole('dialog', { name: 'Lower third templates' }),
        'the Lower Thirds studio, Templates',
        studioSizes,
      );
    });

    // The window for Zoom.
    await chooseMenuItem(app, 'zoom-window');
    const zoom = await windowShowing(app, (p) => p.url().includes('zoom.html'), 'the window for Zoom');
    const zoomSizes = [await smallestContent(app, 'zoom.html'), CI_WINDOW, OWNERS_WINDOW];
    await each(zoom, 'the window for Zoom', () =>
      sweep(app, zoom, 'zoom.html', zoom.locator('body'), 'the window for Zoom', zoomSizes),
    );
  } finally {
    await app.close();
    release.close();
  }
});
