import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, ElectronApplication, Locator, Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import type { SentMail } from '../access-core';
import type { AccessStandIn } from '../access-standin';
import {
  CHAT_API,
  CHAT_INVITE_TTL_MS,
  CHAT_OPERATOR_NAME,
  CHAT_REFUSAL,
  CHAT_TEXT_MAX,
  chatDay,
} from '../../src/shared/chat';
import { apiCall, NETWORK_ENV, networkOn, pairByQr, pairingCode, PHONE, TABLET } from './devices';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { logLines } from './log-lines';
import { decodePng } from './png-decode';
import { filesUnder, findSecrets, type Secret } from './secrets';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';
import {
  bubble,
  CHAT_CLOCK,
  chatView,
  feedFrames,
  giveName,
  keptPairing,
  moveChatClock,
  openChatSection,
  operatorSays,
  phoneIn,
  readAs,
  sayAs,
  scanChatQr,
  scriptPerson,
  sendFrom,
  showChatQr,
  todayAt,
} from './chat-people';

/*
 * The chat's safety, end to end (alpha.23, QA23-CHAT-1, the brief's "Safety: check hardest"): nothing of it on any
 * audience or stage screen, nor sent to a Stage device; Report a Problem's emailed picture of the window with the Chat
 * section blanked, and its diagnostics without a word or a name of it; nothing of it in Drashti's log; the day's
 * change (the chat emptied at midnight, a chat-only phone cut off, a Remote staying; a Drashti opened the next day
 * empty); and the Chat QR's 10 minutes. The day and the 10 minutes on the chat's own clock, moved by the test (the
 * schedules' test clock, DRASHTI_TEST_ARTI_CLOCK: a22-chat-core's). Placeholder names and words only; codes and tokens
 * are made at run time and never printed.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** Drashti looks at the chat's day once a minute even when no one asks (index.ts), on this computer's own time. */
const MINUTE_CHECK_MS = 75_000;

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();

test('never on a screen: the hall’s and the stage’s screens show none of the chat, and a Stage device is sent none of it and may neither read nor write it', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...OUTPUTS });
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    // The hall's screen on the first display, a stage screen on the second.
    await setUpScreen(win, 'Main Hall', 0);
    const stage = await setUpScreen(win, 'Stage', 1);
    await win.evaluate(async (screenId) => {
      const d = (globalThis as PageGlobals).drashti;
      const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
      const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
      if (!set.ok) throw new Error(set.message);
    }, stage);
    await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
    for (const o of outputPages(app)) await outputReady(o);
    const { port, base } = await networkOn(win);

    // A Stage device (a stage display on a tablet), everything its feed is sent watched from before it opens.
    const stageDevice = await phoneIn(apple, TABLET);
    const stageFeed = feedFrames(stageDevice.page);
    await pairByQr(
      stageDevice.page,
      base,
      await pairingCode(win, 'stage', 'Placeholder stage tablet'),
      '/stage',
    );
    await expect.poll(() => stageFeed.frames.some((f) => f.includes('"snapshot"'))).toBe(true);
    const { token: stageToken } = await keptPairing(stageDevice.page);

    // The chat busy: a script's person, a Remote phone and the operator write.
    const remote = await phoneIn(android, PHONE.chromium);
    await pairByQr(
      remote.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder remote phone'),
      '/remote',
    );
    await remote.page.getByTestId('remote-tab-chat').click();
    await giveName(remote.page, 'Placeholder Screen Watcher');
    const script = await scriptPerson(win, port, 'Placeholder Script Writer');
    expect((await sayAs(port, script, 'Placeholder never on a screen one')).status).toBe(200);
    const section = await openChatSection(win);
    await operatorSays(section, 'Placeholder never on a screen two');
    await sendFrom(remote.page, 'Placeholder never on a screen three');
    for (const words of [
      'Placeholder never on a screen one',
      'Placeholder never on a screen two',
      'Placeholder never on a screen three',
    ])
      await expect(bubble(remote.page, words)).toHaveCount(1);

    // On no screen and on the Stage device: none of the words or names, now or a moment later.
    const marks = [
      'Placeholder never on a screen',
      'Placeholder Screen Watcher',
      'Placeholder Script Writer',
    ];
    const pages = [...outputPages(app), stageDevice.page];
    expect(pages).toHaveLength(3);
    const shown = async () => {
      const found: string[] = [];
      for (const page of pages) {
        const html = await page.content();
        for (const mark of marks) if (html.includes(mark)) found.push(`“${mark}” on ${page.url()}`);
      }
      return found;
    };
    await holdStill(
      async () => (await shown()).length === 0,
      1500,
      'no word or name of the chat on any screen',
    );
    expect(stageFeed.frames.filter((f) => f.includes('"type":"chat"'))).toEqual([]);
    expect(stageFeed.frames.filter((f) => marks.some((m) => f.includes(m)))).toEqual([]);

    // A Stage device is not in the chat: it can neither read it nor write in it.
    const read = await readAs(port, stageToken);
    expect(read.status).toBe(403);
    expect(JSON.stringify(read.json)).not.toContain('Placeholder never on a screen');
    const post = await sayAs(port, stageToken, 'Placeholder from a stage');
    expect(post.status).toBe(403);
    expect((await chatView(win)).messages.map((m) => m.text)).not.toContain('Placeholder from a stage');
  } finally {
    for (const b of browsers) await b.close();
    await app.close();
  }
});

/** A feature found by Report a Problem's search and ticked: its box for what went wrong appears. */
async function chooseFeature(dialog: Locator, search: string, name: string): Promise<void> {
  await dialog.getByLabel('Find a feature').fill(search);
  const box = dialog.getByRole('checkbox', { name, exact: true });
  await box.click();
  await expect(box).toBeChecked();
  await expect(dialog.getByLabel(`What went wrong with ${name}?`)).toBeVisible();
}

/** The emails the stand-in list sent since `from`, once there are `n`. */
async function mailsSince(list: AccessStandIn, from: number, n: number): Promise<SentMail[]> {
  await expect.poll(() => list.list.mailbox.length - from, { timeout: 30_000 }).toBe(n);
  return list.list.mailbox.slice(from);
}

test('Report a Problem’s emailed picture of the window has the Chat section blanked, its diagnostics carry no word or name of the chat, and neither does Drashti’s log', async () => {
  test.setTimeout(240_000);
  const { app, userData, access } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const { port } = await networkOn(win);

  // The day's chat: two people, a name changed, refusals, a phone joining by the Chat QR, and the operator.
  const one = await scriptPerson(win, port, 'Placeholder Kept Out One');
  const two = await scriptPerson(win, port, 'Placeholder Kept Out Two');
  expect((await sayAs(port, one, 'Placeholder words kept out one')).status).toBe(200);
  expect((await sayAs(port, two, 'Placeholder words kept out two')).status).toBe(200);
  const tooLong = `Placeholder words refused ${'z'.repeat(CHAT_TEXT_MAX)}`;
  expect((await sayAs(port, two, tooLong)).status).toBe(400);
  const renamed = await apiCall(port, CHAT_API.name, {
    method: 'POST',
    token: two,
    body: { name: 'Placeholder Kept Out Renamed' },
  });
  expect(renamed.status).toBe(200);
  const invite = await showChatQr(win);
  const joined = await apiCall(port, '/api/v1/pair', { method: 'POST', body: { code: invite.code } });
  expect(joined.status).toBe(200);
  const three = String(joined.json['token']);
  expect(
    (
      await apiCall(port, CHAT_API.name, {
        method: 'POST',
        token: three,
        body: { name: 'Placeholder Kept Out Three' },
      })
    ).status,
  ).toBe(200);
  expect((await sayAs(port, three, 'Placeholder words kept out three')).status).toBe(200);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.endInvite());
  const section = await openChatSection(win);
  await operatorSays(section, 'Placeholder words kept out four');
  await section.getByTestId('chat-people-toggle').click();
  await expect(section.getByTestId('chat-person')).toHaveCount(3);
  await expect(bubble(section, 'Placeholder words kept out four')).toBeInViewport();

  // Where the section is in sight in the window, as a share of it (the picture is the window, at its own scale).
  const share = await win.evaluate(() => {
    const el = document.querySelector('[data-testid="section-chat"][data-report-private]');
    const scroller = document.querySelector('[data-testid="live-rest"]');
    if (!el || !scroller) return null;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const top = Math.max(r.top, s.top, 0);
    const bottom = Math.min(r.bottom, s.bottom, innerHeight);
    return {
      left: Math.max(r.left, 0) / innerWidth,
      right: Math.min(r.right, innerWidth) / innerWidth,
      top: top / innerHeight,
      bottom: bottom / innerHeight,
    };
  });
  if (!share) throw new Error('The Chat section is not marked private, or the Live column is not there.');
  expect(share.bottom - share.top, 'the open section is in sight').toBeGreaterThan(0.1);

  // Reported with the diagnostics and a picture of the window, emailed to the admin through the stand-in list.
  const before = access.list.mailbox.length;
  await chooseMenuItem(app, 'report-problem');
  const dialog = win.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  await chooseFeature(dialog, 'time bar', 'The time bar');
  await dialog.getByLabel('What went wrong with The time bar?').fill('Placeholder: the time bar stops.');
  await dialog.getByRole('checkbox', { name: /^Diagnostics/u }).click();
  await dialog.getByRole('checkbox', { name: /^A picture of this window/u }).click();
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(/^Sent: the admin has it\./u)).toBeVisible();
  const [admin] = await mailsSince(access, before, 2);
  const files = admin?.attachments ?? [];
  expect(files.map((f) => f.type)).toEqual(['text/plain', 'image/png']);

  // The words and names, and the Chat QR's code: in neither the email, its diagnostics nor (below) the log.
  const secrets: Secret[] = [
    { label: 'the first message', value: 'Placeholder words kept out one' },
    { label: 'the second message', value: 'Placeholder words kept out two' },
    { label: 'the refused message', value: 'Placeholder words refused' },
    { label: 'the Chat QR phone’s message', value: 'Placeholder words kept out three' },
    { label: 'the operator’s message', value: 'Placeholder words kept out four' },
    { label: 'a person’s name', value: 'Placeholder Kept Out One' },
    { label: 'a person’s first name', value: 'Placeholder Kept Out Two' },
    { label: 'a person’s new name', value: 'Placeholder Kept Out Renamed' },
    { label: 'the Chat QR phone’s name', value: 'Placeholder Kept Out Three' },
    { label: 'the Chat QR’s code', value: invite.code, digits: true },
  ];
  const diagnostics = Buffer.from(files[0]?.base64 ?? '', 'base64').toString('utf8');
  expect(diagnostics).toContain('== Drashti diagnostics ==');
  const inMail = (text: string) =>
    secrets.filter((s) =>
      s.digits ? new RegExp(`(?<![0-9])${s.value}(?![0-9])`, 'u').test(text) : text.includes(s.value),
    );
  expect(inMail(diagnostics).map((s) => `${s.label} in the diagnostics`)).toEqual([]);
  expect(
    inMail(`${admin?.subject ?? ''}\n${admin?.body ?? ''}`).map((s) => `${s.label} in the email`),
  ).toEqual([]);

  // The picture: every pixel of the section in sight is the flat grey of a blanked part (a PNG keeps it exactly).
  const picture = decodePng(Buffer.from(files[1]?.base64 ?? '', 'base64'));
  const x0 = Math.ceil(share.left * picture.width) + 4;
  const x1 = Math.floor(share.right * picture.width) - 4;
  const y0 = Math.ceil(share.top * picture.height) + 4;
  const y1 = Math.floor(share.bottom * picture.height) - 4;
  let looked = 0;
  let notBlank = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const at = (y * picture.width + x) * 4;
      looked++;
      if (picture.rgba[at] !== 128 || picture.rgba[at + 1] !== 128 || picture.rgba[at + 2] !== 128)
        notBlank++;
    }
  expect(looked, 'pixels of the section looked at').toBeGreaterThan(2000);
  expect(notBlank, 'pixels of the Chat section in the picture that are not blanked').toBe(0);

  // More of the day: a person removed, Clear chat. Then nothing of the chat in Drashti's log, which heard it all.
  const removed = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const view = await d.chat.view();
    const who = view.members.find((m) => m.name === 'Placeholder Kept Out One');
    return (await d.chat.remove(who?.id ?? '')).ok;
  });
  expect(removed).toBe(true);
  expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.chat.clear())).ok).toBe(true);
  await app.close();
  expect(
    logLines(userData).some((line) => line.includes('Chat')),
    'the log heard the chat happen',
  ).toBe(true);
  expect(findSecrets(filesUnder(join(userData, 'logs')), secrets)).toEqual([]);
});

test('the day’s change: at midnight every phone’s chat empties at once, a chat-only phone is cut off (paired for that day only) while a Remote stays and writes on; a Drashti opened the next day starts with an empty chat', async () => {
  test.setTimeout(300_000);
  // The chat's clock late in the day, then just past midnight (from one moment of this computer's clock).
  const late = todayAt(23, 58, 0);
  const night = new Date(late);
  night.setDate(night.getDate() + 1);
  night.setHours(0, 0, 30, 0);
  const midnight = night.getTime();
  const first = await launchApp({ ...NETWORK_ENV, ...CHAT_CLOCK });
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  // What the next day's Drashti is asked with: the network's port and the Remote's token (never printed).
  const kept = { port: 0, remoteToken: '' };
  try {
    const win = await operatorPage(first.app);
    await operatorReady(win);
    await sizeOperatorWindow(first.app, win, CI_WINDOW);
    await moveChatClock(first.app, late);
    const { port, base } = await networkOn(win);
    kept.port = port;

    // A phone from the Chat QR, a Remote on its Chat tab, and the operator write late in the day.
    const dayPhone = await phoneIn(android, PHONE.chromium);
    const dayFeed = feedFrames(dayPhone.page);
    await scanChatQr(dayPhone.page, base, (await showChatQr(win)).code);
    await giveName(dayPhone.page, 'Placeholder Day Person');
    const { token: dayToken } = await keptPairing(dayPhone.page);
    const remote = await phoneIn(apple, PHONE.webkit);
    await pairByQr(
      remote.page,
      base,
      await pairingCode(win, 'remote', 'Placeholder remote phone'),
      '/remote',
    );
    await remote.page.getByTestId('remote-tab-chat').click();
    await giveName(remote.page, 'Placeholder Remote Person');
    kept.remoteToken = (await keptPairing(remote.page)).token;
    await sendFrom(dayPhone.page, 'Placeholder: late in the day');
    await sendFrom(remote.page, 'Placeholder: nearly midnight');
    const section = await openChatSection(win);
    await operatorSays(section, 'Placeholder: the operator, late');
    for (const p of [dayPhone.page, remote.page]) await expect(p.getByTestId('chat-message')).toHaveCount(3);
    expect((await chatView(win)).day).toBe(chatDay(late));

    // Midnight passes with no one asking: within the minute's check, every chat empties at once, and the chat-only
    // phone, paired for its day only, is cut off.
    await moveChatClock(first.app, midnight);
    await expect(remote.page.getByTestId('chat-empty')).toBeVisible({ timeout: MINUTE_CHECK_MS });
    await expect(remote.page.getByTestId('chat-message')).toHaveCount(0);
    await expect(section.getByTestId('chat-empty')).toBeVisible();
    const today = await chatView(win);
    expect(today.day).toBe(chatDay(midnight));
    expect(today.messages).toEqual([]);
    await expect
      .poll(() => dayFeed.frames.some((f) => f.includes('"bye"') && f.includes('"revoked"')))
      .toBe(true);
    await dayPhone.page.waitForURL(`${base}/pair?why=revoked`, { timeout: 15_000 });
    expect((await readAs(port, dayToken)).status).toBe(401);
    expect((await sayAs(port, dayToken, 'Placeholder: after midnight')).status).toBe(401);

    // The Remote stays paired, gives its kept name again by itself (a new day starts without names), and writes on.
    await expect(remote.page.getByTestId('chat-own-name')).toHaveText('Placeholder Remote Person');
    await sendFrom(remote.page, 'Placeholder: a new day');
    await expect(bubble(section, 'Placeholder: a new day').getByTestId('chat-sender')).toHaveText(
      'Placeholder Remote Person',
    );
    expect((await chatView(win)).people.map((p) => p.name)).toEqual([
      CHAT_OPERATOR_NAME,
      'Placeholder Remote Person',
    ]);
  } finally {
    for (const b of browsers) await b.close();
    await first.app.close();
  }

  // Drashti opened again a day later (the chat's clock a day on): its chat starts empty, the Remote still paired.
  const nextDay = midnight + ONE_DAY_MS;
  const again = await relaunchApp(first.userData, {
    ...NETWORK_ENV,
    ...CHAT_CLOCK,
    DRASHTI_TEST_ARTI_OFFSET_MS: String(nextDay - Date.now()),
  });
  try {
    const win = await operatorPage(again.app);
    await operatorReady(win);
    await expect
      .poll(() =>
        win.evaluate(async () => (await (globalThis as PageGlobals).drashti.network.status()).state),
      )
      .toBe('listening');
    const view = await chatView(win);
    expect(view.day).toBe(chatDay(nextDay));
    expect(view.messages).toEqual([]);
    expect(view.people.map((p) => p.name)).toEqual([CHAT_OPERATOR_NAME]);
    const read = await readAs(kept.port, kept.remoteToken);
    expect(read.status).toBe(200);
    expect(read.json['chat']).toMatchObject({ messages: [], you: { name: null } });
    const file = join(first.userData, 'chat', 'today.json');
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').not.toContain('Placeholder: a new day');
  } finally {
    await again.app.close();
  }
});

test('the Chat QR works for 10 minutes on the chat’s clock: a phone joins at 9:59, one is told at 10:01 that it has ended, and the phone it paired stays in the chat for the day', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, ...CHAT_CLOCK });
  const browsers: Browser[] = [await chromium.launch(), await webkit.launch()];
  const [android, apple] = browsers as [Browser, Browser];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Midday on the chat's clock, so its 10 minutes are far from any day's change.
    const noon = todayAt(12, 0, 0);
    await moveChatClock(app, noon);
    const { base } = await networkOn(win);
    const invite = await showChatQr(win);
    expect(invite.expiresAt - noon).toBeGreaterThanOrEqual(CHAT_INVITE_TTL_MS);
    expect(invite.expiresAt - noon).toBeLessThan(CHAT_INVITE_TTL_MS + 60_000);

    // A second before its end: a phone joins by it.
    await moveChatClock(app, invite.expiresAt - 1000);
    const early = await phoneIn(android, PHONE.chromium);
    await scanChatQr(early.page, base, invite.code);
    await giveName(early.page, 'Placeholder Early Person');
    expect((await keptPairing(early.page)).kind).toBe('chat');

    // A second after: it has ended, said in plain words, no pairing kept, and the Chat QR is off in the window's view.
    await moveChatClock(app, invite.expiresAt + 1000);
    const late = await phoneIn(apple, PHONE.webkit);
    await late.page.goto(`${base}/chat#c=${invite.code}`);
    await expect(late.page.getByTestId('chat-refused')).toContainText(CHAT_REFUSAL.ended);
    expect((await keptPairing(late.page)).kind).toBeNull();
    await expect.poll(async () => (await chatView(win)).invite).toBeNull();
    await expect
      .poll(async () =>
        win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.network.status()).chatInvite ?? null,
        ),
      )
      .toBeNull();

    // The phone it paired is in the chat for the day, not for the QR's 10 minutes: it writes on.
    await sendFrom(early.page, 'Placeholder: after the ten minutes');
    await expect
      .poll(async () => (await chatView(win)).messages.map((m) => m.text))
      .toEqual(['Placeholder: after the ten minutes']);
  } finally {
    for (const b of browsers) await b.close();
    await app.close();
  }
});
