import type {
  Browser,
  BrowserContext,
  ElectronApplication,
  Locator,
  Page,
  WebSocket,
} from '@playwright/test';
import { devices, expect } from '@playwright/test';
import { CHAT_API, type ChatInvite, type ChatOperatorView } from '../../src/shared/chat';
import type { DeviceKind } from '../../src/shared/network';
import { apiCall, pairToken } from './devices';
import type { PageGlobals } from './helpers';

/*
 * The people in the chat (alpha.23, QA23-CHAT-1), as the chat's end-to-end scenarios drive them (chat-group.spec.ts,
 * chat-safety.spec.ts): phones in real browsers (Chrome on Android, Safari on an iPhone), each a context of its own
 * (its own storage: its own pairing and name), pairing by the Chat QR's address or a Remote's pairing QR; a script's
 * Remote as a person too; and the operator window's Chat section. The ids are a22-chat-phone's and a22-chat-operator's.
 * Placeholder names and words only; codes and tokens are made at run time and never printed (a failure names what it
 * looked for, never a token).
 */

/** A phone: a browser context of its own (its own storage, so its own pairing and name), at a phone's size. */
export interface Phone {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * A phone in this browser, as `name` (Playwright's devices). Its page's CSP is bypassed, so a word a page wrongly
 * turned into markup would run: "nothing runs" is then the page's own escaping, never the CSP's doing.
 */
export async function phoneIn(browser: Browser, name: string): Promise<Phone> {
  const context = await browser.newContext({ ...devices[name], bypassCSP: true });
  const page = await context.newPage();
  return { context, page, close: () => context.close() };
}

/** Show the Chat QR from the operator window (as the Phones panel's Show does); its code, address and end. */
export function showChatQr(win: Page): Promise<ChatInvite> {
  return win.evaluate(async () => {
    const shown = await (globalThis as PageGlobals).drashti.chat.invite();
    if (!shown.ok) throw new Error(shown.message);
    if (!shown.view.invite) throw new Error('The Chat QR is not shown.');
    return shown.view.invite;
  });
}

/** The operator window's view of the chat, as Main has it. */
export const chatView = (win: Page): Promise<ChatOperatorView> =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.chat.view());

/** A phone scans the Chat QR: the chat's page opens, the code leaves the address, and the name is asked once. */
export async function scanChatQr(p: Page, base: string, code: string): Promise<void> {
  await p.goto(`${base}/chat#c=${code}`);
  await expect(p.getByTestId('chat-page')).toBeVisible();
  await expect(p.getByTestId('chat-name')).toBeVisible();
  expect(new URL(p.url()).hash, 'the code leaves the address at once').toBe('');
}

/** What the phone keeps of its pairing (device.ts): its kind, and its token for the test's own requests. */
export async function keptPairing(p: Page): Promise<{ kind: DeviceKind | null; token: string }> {
  return p.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as {
      kind?: DeviceKind;
      token?: string;
    };
    return { kind: kept.kind ?? null, token: kept.token ?? '' };
  });
}

/** Give a name on the phone's chat (asked once). */
export async function giveName(p: Page, name: string): Promise<void> {
  await expect(p.getByTestId('chat-name')).toBeVisible();
  await p.getByTestId('chat-name').fill(name);
  await p.getByTestId('chat-name-save').click();
  await expect(p.getByTestId('chat-own-name')).toHaveText(name);
}

/** Send from the phone's chat: taken by Drashti, the box empties. */
export async function sendFrom(p: Page, text: string): Promise<void> {
  await p.getByTestId('chat-text-box').fill(text);
  await p.getByTestId('chat-send').click();
  await expect(p.getByTestId('chat-text-box')).toHaveValue('');
}

/** A message on a phone, or in the operator's section, by words it holds. */
export const bubble = (where: Page | Locator, text: string): Locator =>
  where.getByTestId('chat-message').filter({ hasText: text });

/** The words of every message a phone (or the operator's section) shows, top to bottom. */
export const shownTexts = (where: Page | Locator): Promise<string[]> =>
  where.getByTestId('chat-text').allTextContents();

/**
 * A person whose Remote is a script's (paired through the API), named in the chat: its token (never printed). The
 * device's own name (the operator's, which the log may say) is never the person's: a test can look for theirs.
 */
export async function scriptPerson(win: Page, port: number, name: string): Promise<string> {
  const token = await pairToken(win, port, 'remote', 'Placeholder script phone');
  const named = await apiCall(port, CHAT_API.name, { method: 'POST', token, body: { name } });
  expect(named.status, `${name} is named in the chat`).toBe(200);
  return token;
}

/** A message from a script's person; Drashti's answer. */
export const sayAs = (port: number, token: string, text: string) =>
  apiCall(port, CHAT_API.send, { method: 'POST', token, body: { text } });

/** The day's chat as a device reads it (GET /api/v1/chat with its token); the status and Drashti's answer. */
export const readAs = (port: number, token: string) => apiCall(port, CHAT_API.read, { token });

/** The Live column's Chat section in the operator window (a22-chat-operator's). */
export const chatSection = (win: Page): Locator =>
  win.getByRole('complementary', { name: 'Live', exact: true }).getByTestId('section-chat');

/** The Chat section open, in sight. */
export async function openChatSection(win: Page): Promise<Locator> {
  const toggle = win.getByTestId('group-chat-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const section = chatSection(win);
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** The operator writes in the section (as Operator), with Enter. */
export async function operatorSays(section: Locator, text: string): Promise<void> {
  const box = section.getByTestId('chat-text-box');
  await box.fill(text);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

/**
 * Everything a page's feed is sent, as text, from before the page opens (Playwright's own view of its WebSockets):
 * what a chat event, or a word of one, would look like if it ever reached the page.
 */
export function feedFrames(p: Page): { frames: string[]; sockets: WebSocket[] } {
  const seen = { frames: [] as string[], sockets: [] as WebSocket[] };
  p.on('websocket', (socket) => {
    seen.sockets.push(socket);
    socket.on('framereceived', (frame) => {
      seen.frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'));
    });
  });
  return seen;
}

/** A moment on this computer's own clock: today (or `days` later) at hh:mm:ss. */
export function todayAt(hours: number, minutes: number, seconds: number, days = 0): number {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(hours, minutes, seconds, 0);
  return at.getTime();
}

/** The schedules' test clock, which the chat's day and its Chat QR read (DRASHTI_TEST_ARTI_CLOCK; a22-chat-core). */
export const CHAT_CLOCK = { DRASHTI_TEST_ARTI_CLOCK: '1' } as const;

/** Tests only: the chat's clock (the schedules') set to `wallMs` on this computer's clock, and the chat told. */
export async function moveChatClock(app: ElectronApplication, wallMs: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    const move = (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock;
    if (!move) throw new Error('The schedules’ test clock is not on (DRASHTI_TEST_ARTI_CLOCK).');
    move(ms);
  }, wallMs);
}
