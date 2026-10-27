import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ACCESS_ERROR_TEXT } from '../../src/shared/access-protocol';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  approvedToken,
  moveListClock,
  openLink,
  ownerCall,
  PLACEHOLDER_PERSON,
  pressLink,
  revoke,
} from './access';
import { expectFits } from './fit';
import { launchApp, lockPage, operatorPage, operatorReady } from './helpers';

/*
 * The lock (Session 54, access by Gmail, E2): Drashti opens to a lock screen until this computer is let in. Request
 * Access with a Gmail makes the row "requested" and emails the approver Approve and Reject; Approve emails the person
 * their one-time token; Reject is told plainly, and nothing more happens; I Have a Token lets this computer in for
 * that Gmail. The links are signed and work once; a token works once, only for its own Gmail, never after a revoke,
 * and runs out after 3 days. Against the stand-in list on 127.0.0.1 (the list's own rules), placeholder addresses
 * only; tokens are never printed.
 */

const OTHER = 'other.placeholder@example.com';

/** A Drashti on a computer never let in: the lock window, and nothing else of Drashti. */
async function locked(
  o: Parameters<typeof launchApp>[2] = {},
): Promise<{ app: ElectronApplication; lock: Page; list: Awaited<ReturnType<typeof launchApp>>['access'] }> {
  const { app, access: list } = await launchApp({}, undefined, { as: 'locked', ...o });
  const lock = await lockPage(app);
  await expect(lock.getByTestId('access-lock')).toHaveAttribute('data-phase', 'locked');
  return { app, lock, list };
}

/** The Status column of a Gmail's row in the list's Sheet. */
const statusOf = (list: Awaited<ReturnType<typeof launchApp>>['access'], gmail: string) =>
  String(list.list.sheet.find('Access List', 'Gmail', gmail)?.['Status'] ?? '');

/** I Have a Token, typed as a person would; answers once the list has been asked. */
async function useToken(
  lock: Page,
  list: Awaited<ReturnType<typeof launchApp>>['access'],
  gmail: string,
  token: string,
): Promise<void> {
  const asked = list.calls.filter((c) => c === 'redeem').length;
  await lock.getByTestId('access-tab-token').click();
  await lock.getByTestId('access-gmail').fill(gmail);
  await lock.getByTestId('access-token').fill(token);
  await lock.getByTestId('access-redeem').click();
  await expect.poll(() => list.calls.filter((c) => c === 'redeem').length).toBe(asked + 1);
}

/** The token refused: said on its field once the lock screen has the list's answer, and still locked. */
async function refused(lock: Page): Promise<void> {
  await expect(lock.getByTestId('access-redeem')).toHaveText('Let This Computer In');
  await expect(lock.getByTestId('access-redeem')).toBeEnabled();
  await expect(lock.getByText(ACCESS_ERROR_TEXT['bad-token'])).toBeVisible();
  await expect(lock.getByTestId('access-lock')).toHaveAttribute('data-phase', 'locked');
}

test('a computer not let in opens to the lock screen; Request Access, Approve, and the token from the email let it in', async () => {
  test.setTimeout(120_000);
  const { app, lock, list } = await locked();
  try {
    // Nothing of Drashti is open: no operator window, no screen.
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);
    await expect(lock.getByTestId('access-reason')).toContainText('Ask for access with your Gmail');
    await expectFits(lock.getByTestId('access-lock'), 'the lock screen');
    await expectNoSeriousA11yIssues(lock, 'the lock screen');

    // Request Access: the row requested, and the approver emailed Approve and Reject.
    await lock.getByTestId('access-gmail').fill(PLACEHOLDER_PERSON);
    await lock.getByTestId('access-name').fill('Placeholder Person');
    await lock.getByTestId('access-request').click();
    await expect(lock.getByTestId('access-message')).toContainText(
      'The person who approves access has been emailed',
    );
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('requested');
    const links = list.list.linksFor(PLACEHOLDER_PERSON);
    expect(links).not.toBeNull();
    // The approver's email went to the approver, never to the person.
    expect(list.list.mailTo(list.approver).length).toBe(1);
    expect(list.list.tokenFor(PLACEHOLDER_PERSON)).toBeNull();

    // The link opens a page with one button; nothing happens until it is pressed (an email scanner).
    const page = await openLink(links?.approve ?? '');
    expect(page).toEqual({ kind: 'ready', title: `Approve ${PLACEHOLDER_PERSON}?`, button: true });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('requested');
    expect(await pressLink(links?.approve ?? '')).toMatchObject({ kind: 'done', title: 'Approved' });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('approved');
    const token = list.list.tokenFor(PLACEHOLDER_PERSON) ?? '';
    expect(token).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/u);
    // The token came in an email to the person (from the approver's own account, in the list's Google account).
    expect(list.list.mailTo(PLACEHOLDER_PERSON).at(-1)?.subject).toBe('Your Drashti token');

    // The lock screen hears it was approved, and turns to I Have a Token.
    await lock.getByTestId('access-check-request').click();
    await expect(lock.getByTestId('access-message')).toContainText('Approved');
    await expect(lock.getByTestId('access-token')).toBeVisible();
    await lock.getByTestId('access-token').fill(token.toLowerCase());
    await lock.getByTestId('access-redeem').click();

    // Let in: Drashti opens, and the lock window goes.
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect.poll(() => lock.isClosed()).toBe(true);
    expect(list.calls).toContain('redeem');
    expect(list.calls.at(-1)).toBe('check');
  } finally {
    await app.close();
  }
});

test('Reject tells the person plainly, and nothing more happens; each link works once, a forged or old one says so', async () => {
  test.setTimeout(120_000);
  const { app, lock, list } = await locked();
  try {
    await lock.getByTestId('access-gmail').fill(PLACEHOLDER_PERSON);
    await lock.getByTestId('access-request').click();
    await expect(lock.getByTestId('access-message')).toContainText('emailed');
    const links = list.list.linksFor(PLACEHOLDER_PERSON);
    const reject = links?.reject ?? '';
    const approve = links?.approve ?? '';

    // A forged link (its signature changed) and a link of another request say so, and change nothing.
    const forged = reject.replace(/&s=([0-9a-f])/u, (_m, c: string) => `&s=${c === '0' ? '1' : '0'}`);
    expect(await pressLink(forged)).toMatchObject({ kind: 'forged' });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('requested');

    // Reject, once: the person is told by email, and the lock screen says so plainly.
    expect(await openLink(reject)).toMatchObject({ kind: 'ready', title: `Reject ${PLACEHOLDER_PERSON}?` });
    expect(await pressLink(reject)).toMatchObject({ kind: 'done', title: 'Rejected' });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('rejected');
    expect(list.list.mailTo(PLACEHOLDER_PERSON).length).toBe(1);
    await lock.getByTestId('access-check-request').click();
    await expect(lock.getByTestId('access-message')).toHaveText('Your request for access was not approved.');
    // Each link works once: the reject again, or the approve after it, changes nothing.
    expect(await pressLink(reject)).toMatchObject({ kind: 'used' });
    expect(await pressLink(approve)).toMatchObject({ kind: 'used' });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('rejected');
    expect(list.list.tokenFor(PLACEHOLDER_PERSON)).toBeNull();
    // Nothing more happens: Drashti stays locked, with no operator window.
    await expect(lock.getByTestId('access-lock')).toHaveAttribute('data-phase', 'locked');
    expect(app.windows().filter((w) => !w.url().includes('lock.html'))).toEqual([]);

    // Asked again: a new request, whose links run out after 7 days (the list's own clock moved on).
    await lock.getByTestId('access-tab-request').click();
    await lock.getByTestId('access-request').click();
    await expect(lock.getByTestId('access-message')).toContainText('emailed');
    const again = list.list.linksFor(PLACEHOLDER_PERSON)?.approve ?? '';
    expect(again).not.toBe(approve);
    // The first request's links were replaced by the new request's.
    expect(await pressLink(approve)).toMatchObject({ kind: 'replaced' });
    moveListClock(list, 7 * 24 * 3_600_000 + 60_000);
    expect(await pressLink(again)).toMatchObject({ kind: 'out-of-date' });
    expect(statusOf(list, PLACEHOLDER_PERSON)).toBe('requested');
  } finally {
    await app.close();
  }
});

test('a token works once, only for its own Gmail, never after a revoke, runs out after 3 days, and lets in one computer', async () => {
  test.setTimeout(180_000);
  const { app, lock, list } = await locked();
  let second: ElectronApplication | null = null;
  try {
    // Another Gmail's token, typed with this one: refused.
    const others = approvedToken(list, OTHER);
    await useToken(lock, list, PLACEHOLDER_PERSON, others);
    await refused(lock);
    // A token for this Gmail, its Gmail revoked before it was used: refused.
    const revoked = approvedToken(list, PLACEHOLDER_PERSON);
    revoke(list, PLACEHOLDER_PERSON);
    await useToken(lock, list, PLACEHOLDER_PERSON, revoked);
    await refused(lock);
    // Given access again: a new token, which runs out 3 days after it was sent.
    expect(ownerCall(list, 'regrant', { target: PLACEHOLDER_PERSON }).ok).toBe(true);
    const ranOut = list.list.tokenFor(PLACEHOLDER_PERSON) ?? '';
    moveListClock(list, 3 * 24 * 3_600_000 + 60_000);
    await useToken(lock, list, PLACEHOLDER_PERSON, ranOut);
    await refused(lock);
    // A new one, used in time: this computer is let in.
    expect(ownerCall(list, 'regrant', { target: PLACEHOLDER_PERSON }).ok).toBe(true);
    const good = list.list.tokenFor(PLACEHOLDER_PERSON) ?? '';
    await useToken(lock, list, PLACEHOLDER_PERSON, good);
    await operatorReady(await operatorPage(app));

    // The same token on a second computer: used already. One computer per token: a second needs its own.
    const other = await launchApp({}, undefined, { as: 'locked', standIn: list });
    second = other.app;
    const lock2 = await lockPage(second);
    await useToken(lock2, list, PLACEHOLDER_PERSON, good);
    await refused(lock2);
    // Given access again, the second computer has a token of its own; the first stays in.
    expect(ownerCall(list, 'regrant', { target: PLACEHOLDER_PERSON }).ok).toBe(true);
    await useToken(lock2, list, PLACEHOLDER_PERSON, list.list.tokenFor(PLACEHOLDER_PERSON) ?? '');
    await operatorReady(await operatorPage(second));
    const used = list.list.sheet
      .records('Computers')
      .filter((r) => r['Gmail'] === PLACEHOLDER_PERSON && Boolean(r['Token used']));
    expect(used.length).toBe(2);
  } finally {
    await second?.close();
    await app.close();
  }
});

test('the lock screen fits a small window and says what is wrong on the field it is about', async () => {
  const { app, lock } = await locked();
  try {
    await lock.setViewportSize({ width: 480, height: 420 });
    await lock.getByTestId('access-gmail').fill('not an address');
    await lock.getByTestId('access-request').click();
    await expect(lock.getByText(ACCESS_ERROR_TEXT['bad-gmail'])).toBeVisible();
    await expect(lock.getByTestId('access-gmail')).toHaveAttribute('aria-invalid', 'true');
    await expectNoSeriousA11yIssues(lock, 'the lock screen, a Gmail that is not one');
    await lock.getByTestId('access-tab-token').click();
    await lock.getByTestId('access-gmail').fill(PLACEHOLDER_PERSON);
    await lock.getByTestId('access-token').fill('ABCD-EFGH');
    await lock.getByTestId('access-redeem').click();
    await expect(lock.getByText('That is not a whole token')).toBeVisible();
    await expect(lock.getByTestId('access-token')).toHaveAttribute('aria-invalid', 'true');
    // Quit works.
    await lock.getByTestId('access-quit').click();
    await expect.poll(() => app.process().exitCode, { timeout: 20_000 }).toBe(0);
  } finally {
    if (app.process().exitCode === null) await app.close();
  }
});
