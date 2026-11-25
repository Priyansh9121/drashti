import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { PHONE_REFUSAL, type PhoneWords } from '../../src/shared/phone-rule';
import { apiCall } from './devices';
import type { PageGlobals } from './helpers';

/*
 * The phone rule (alpha.23, QA23-PHONE-1, src/shared/phone-rule.ts), as the end-to-end tests prove it: a phone that
 * asks for something it may no longer do is refused (403, {ok: false}, in its group's exact words) and the show on
 * Drashti's computer is as it was. The owner's words: "no video access in either of simple or pro mode in phone, they
 * cant change videos, only ppts an pdfs, that also in pro mode, in simple mode only show the flow, whats running in
 * live, and chat".
 */

/**
 * Who asks: a Remote token, as a script (Companion, a Stream Deck) or a test makes the request; or a paired phone's own
 * page, with the token it keeps. `win` is the operator window, whose show is read before and after.
 */
export type RefusingPhone = { win: Page; port: number; token: string } | { win: Page; page: Page };

/** What Drashti learns by itself as screens play (a file's length, its pixels, captions): never a phone's change. */
const LEARNED = new Set([
  'durationMs',
  'videoFiles',
  'opaquePictures',
  'captions',
  'videoCaptions',
  'calendar',
  'quote',
  'sound',
]);

/** The show as the engine has it, without what it learns by itself meanwhile. */
function showOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(showOf);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !LEARNED.has(key))
      .map(([key, v]) => [key, showOf(v)]),
  );
}

const deskShow = async (win: Page): Promise<unknown> =>
  showOf(await win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state));

/** The request as the phone's own page makes it (src/renderer/src/web/device.ts api(): the token it keeps). */
function fromPage(
  page: Page,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      let token = '';
      try {
        token =
          (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { token?: string }).token ?? '';
      } catch {
        // Nothing kept: asked without a token (and refused as unpaired, which the check then shows).
      }
      const response = await fetch(path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        // Not JSON.
      }
      return { status: response.status, json };
    },
    { method, path, body },
  );
}

/**
 * A phone asks for what the phone rule takes away: Drashti answers 403, {ok: false}, in exactly `words`' sentence
 * (PHONE_REFUSAL), and the show on the computer (the engine's state, and whatever `also` reads: the library, the
 * music, the wallpapers) is the same after as before. `body` undefined sends none (a GET).
 */
export async function expectPhoneRefuses(
  phone: RefusingPhone,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  words: PhoneWords,
  also?: () => Promise<unknown>,
): Promise<void> {
  await test.step(`a phone is refused: ${method} ${path} (${words})`, async () => {
    const before = await deskShow(phone.win);
    const alsoBefore = also ? await also() : undefined;
    const answer =
      'page' in phone
        ? await fromPage(phone.page, method, path, body)
        : await apiCall(phone.port, path, { method, token: phone.token, body });
    expect(answer.status, `${method} ${path}`).toBe(403);
    expect(answer.json, `${method} ${path}`).toEqual({ ok: false, message: PHONE_REFUSAL[words] });
    expect(await deskShow(phone.win), `the show after ${method} ${path}`).toEqual(before);
    if (also) expect(await also(), `the desk after ${method} ${path}`).toEqual(alsoBefore);
  });
}
