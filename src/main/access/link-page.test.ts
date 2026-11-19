import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_LIST_DIR,
  callBody,
  core,
  makeTestKeys,
  PLACEHOLDER_APPROVER,
  placeholderComputer,
  readAnswer,
  TestList,
  type TestKeys,
} from '../../../tests/access-core';
import { ACCESS_LIST_URL } from '../../shared/access-config';

/*
 * The link page (x38: the owner's words of 19 Nov 2026, "he should be able to approve" from a phone or any browser):
 * access-list/page/index.html, which GitHub Pages serves and each emailed Approve or Reject link opens, outside Google,
 * so it opens whatever Google accounts the browser is signed in to. Here its own script runs against the list's own
 * rules (core.js, through the tests' list in memory) in a small document made in memory with what the page uses; the
 * end-to-end tests run it in Chromium (access-lengths.spec.ts). Placeholder addresses only.
 */

const PAGE_FILE = join(ACCESS_LIST_DIR, 'page', 'index.html');
const PERSON = 'placeholder.user@example.com';
const html = () => readFileSync(PAGE_FILE, 'utf8');
const inline = (tag: 'script' | 'style') =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u').exec(html())?.[1] ?? '';
const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const csp = () => /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(html())?.[1] ?? '';

let keys: TestKeys;
beforeAll(() => {
  keys = makeTestKeys();
});

// ---- a document in memory, with what the page uses ----

class FakeElement {
  id = '';
  type = '';
  name = '';
  value = '';
  className = '';
  disabled = false;
  hidden = false;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  private text = '';
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, (() => void)[]>();
  private on = false;

  constructor(
    readonly doc: FakeDocument,
    readonly tag: string,
  ) {}

  get checked(): boolean {
    return this.on;
  }

  set checked(v: boolean) {
    // A radio button chosen: the others of its name are not (as a browser does).
    if (v && this.type === 'radio' && this.name)
      for (const r of this.doc.all())
        if (r !== this && r.type === 'radio' && r.name === this.name) r.on = false;
    this.on = v;
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.text = v;
  }

  appendChild(c: FakeElement): FakeElement {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  focus(): void {
    this.doc.focused = this;
  }

  /** The person's click: a button that is not disabled, or a choice. */
  click(): void {
    if (this.disabled) return;
    if (this.type === 'radio') this.checked = true;
    this.fire('click');
  }

  /** The person types into a box. */
  type_(text: string): void {
    this.value = text;
    this.fire('input');
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
}

class FakeDocument {
  focused: FakeElement | null = null;
  readonly body: FakeElement;

  constructor() {
    this.body = new FakeElement(this, 'body');
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  all(): FakeElement[] {
    return this.body.descendants();
  }

  getElementById(id: string): FakeElement | null {
    return this.all().find((e) => e.id === id) ?? null;
  }
}

interface Sent {
  url: string;
  init: Record<string, unknown>;
  body: Record<string, unknown>;
}

/**
 * The page opened at `hash`, its script run in a document in memory as the page's HTML makes it. Its calls go to the
 * list given (as the web app hands them to core.js), or fail (`reach: false`), or wait until the page gives up
 * (`reach: 'never'`).
 */
function openPage(list: TestList, hash: string, o: { reach?: boolean | 'never'; framed?: boolean } = {}) {
  const doc = new FakeDocument();
  const page = html();
  // The page's own parts, as its HTML has them.
  const main = doc.body.appendChild(doc.createElement('main'));
  main.id = 'page';
  main.setAttribute('data-list', /data-list="([^"]+)"/u.exec(page)?.[1] ?? '');
  for (const [tag, id] of [
    ['h1', 'title'],
    ['div', 'lines'],
    ['div', 'choices'],
    ['p', 'wait'],
  ] as const) {
    expect(page).toContain(`id="${id}"`);
    main.appendChild(doc.createElement(tag)).id = id;
  }
  const sent: Sent[] = [];
  const timers: (() => void)[] = [];
  let reach = o.reach ?? true;
  const fetch = (url: string, init: Record<string, unknown>) => {
    const body = JSON.parse(String(init['body'])) as Record<string, unknown>;
    sent.push({ url, init, body });
    if (reach === 'never')
      return new Promise((_ok, fail) => {
        (init['signal'] as AbortSignal).addEventListener('abort', () => {
          fail(new Error('aborted'));
        });
      });
    if (!reach) return Promise.reject(new TypeError('Failed to fetch'));
    const answer = JSON.parse(JSON.stringify(list.handle(String(init['body'])))) as unknown;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
  };
  const window: Record<string, unknown> = { location: { hash } };
  window['self'] = window;
  window['top'] = o.framed ? {} : window;
  const context = createContext({
    window,
    document: doc,
    fetch,
    AbortController,
    URLSearchParams,
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => undefined,
  });
  runInContext(inline('script'), context, { filename: 'index.html' });
  const by = (id: string) => doc.getElementById(id);
  return {
    doc,
    sent,
    timers,
    reachable: (r: boolean | 'never') => {
      reach = r;
    },
    title: () => by('title')?.textContent ?? '',
    lines: () => (by('lines')?.children ?? []).map((p) => p.textContent),
    wait: () => by('wait')?.textContent ?? '',
    buttons: () => doc.all().filter((e) => e.tag === 'button'),
    radios: (name: string) => doc.all().filter((e) => e.type === 'radio' && e.name === name),
    /** A choice by the words beside it. */
    choice: (words: string) => {
      const label = doc.all().find((e) => e.tag === 'label' && e.textContent.trim() === words);
      const input = label?.children.find((c) => c.tag === 'input');
      if (!input) throw new Error(`No choice "${words}"`);
      return input;
    },
    by,
  };
}

/** Every promise the page is waiting on, settled. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A request made, as a person's Drashti makes one: its Approve and Reject links' # parts. */
function asked(list: TestList, gmail = PERSON) {
  const { body } = callBody('request', placeholderComputer(`page-${gmail}`), {
    gmail,
    name: 'Placeholder Person',
  });
  expect(readAnswer(list.handle(JSON.stringify(body)), keys.publicKey)).toMatchObject({ ok: true });
  const links = list.linksFor(gmail);
  if (!links) throw new Error('No links');
  return { approve: new URL(links.approve).hash, reject: new URL(links.reject).hash };
}

const row = (list: TestList, gmail = PERSON) => list.sheet.find('Access List', 'Gmail', gmail);

/** The owner adds a Gmail from their own Drashti (the Access List's Add a Gmail…): it waits as a request. */
function ownerAdds(list: TestList, gmail: string, fields: Record<string, unknown>): void {
  core.letOwnerIn(list.env);
  const computer = placeholderComputer('page-owner');
  const token = list.tokenFor(PLACEHOLDER_APPROVER) ?? '';
  const call = (op: string, f: Record<string, unknown>, grant?: Parameters<typeof callBody>[3]) =>
    readAnswer(list.handle(JSON.stringify(callBody(op, computer, f, grant).body)), keys.publicKey);
  const r = call('redeem', { gmail: PLACEHOLDER_APPROVER, token });
  const grant = { gmail: PLACEHOLDER_APPROVER, grantId: String(r['grantId']), secret: String(r['secret']) };
  expect(call('add', { at: Math.floor(list.t), target: gmail, ...fields }, grant)).toMatchObject({
    ok: true,
  });
}

describe('the link page', () => {
  it('asks the list’s own address, built in as Drashti’s is, with no Google sign-in, plain text, and only Google’s two script hosts', () => {
    const page = html();
    expect(/data-list="([^"]+)"/u.exec(page)?.[1]).toBe(ACCESS_LIST_URL);
    const script = inline('script');
    expect(script).toContain("credentials: 'omit'");
    expect(script).toContain("method: 'POST'");
    // No header: a plain text body, which no browser asks the list about first (Apps Script answers no OPTIONS).
    expect(script).not.toMatch(/headers\s*:/u);
    expect(script).not.toContain('google.script');
    expect(script).not.toContain('innerHTML');
    // Its Content-Security-Policy: nothing but its own script and style, and calls only to Google's script hosts.
    expect(
      csp()
        .split(';')
        .map((d) => d.trim()),
    ).toEqual([
      "default-src 'none'",
      `script-src ${sha256(script)}`,
      `style-src ${sha256(inline('style'))}`,
      'connect-src https://script.google.com https://script.googleusercontent.com',
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    expect(page).toContain('<meta name="referrer" content="no-referrer" />');
    // Nothing from anywhere else, and no address of anyone's.
    expect(page).not.toMatch(/\s(?:src|href)=/u);
    expect(page).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/u);
    expect(page).toContain('<html lang="en">');
  });

  it('opens what an Approve link is for, and its one button approves, once, for the length and mode chosen', async () => {
    const list = new TestList({ keys });
    const { approve } = asked(list);
    const p = openPage(list, approve);
    expect(p.wait()).toBe('One moment…');
    await settle();
    expect(p.title()).toBe(`Approve ${PERSON}?`);
    expect(p.lines()).toContain('Name they typed: Placeholder Person');
    expect(p.wait()).toBe('');
    // Read: nothing changes.
    expect(row(list)?.['Status']).toBe('requested');
    expect(list.tokenFor(PERSON)).toBeNull();
    expect(p.sent).toHaveLength(1);
    const [read] = p.sent;
    expect(read?.url).toBe(ACCESS_LIST_URL);
    expect(read?.init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    expect(read?.init['headers']).toBeUndefined();
    expect(read?.body).toEqual({
      link: 'read',
      ...Object.fromEntries(new URLSearchParams(approve.slice(1))),
    });
    // The lengths, Unlimited chosen; what they may use, Simple Mode only chosen; one button.
    expect(p.radios('length').map((r) => r.value)).toEqual([
      'unlimited',
      '1',
      '7',
      '30',
      '60',
      '90',
      '120',
      '180',
      '365',
      'typed',
    ]);
    expect(p.choice('Unlimited, until you revoke it').checked).toBe(true);
    expect(p.choice('1 day (24 hours)').checked).toBe(false);
    expect(p.choice('30 days').value).toBe('30');
    expect(p.radios('mode').map((r) => [r.value, r.checked])).toEqual([
      ['simple', true],
      ['pro', false],
    ]);
    expect(p.choice('Pro Mode and Simple Mode').value).toBe('pro');
    expect(p.by('typed')?.getAttribute('max')).toBe('730');
    expect(p.by('typed')?.getAttribute('aria-label')).toBe('Number of days');
    expect(p.buttons().map((b) => b.textContent)).toEqual(['Approve']);
    // 30 days, Pro: approved once, for them.
    p.choice('30 days').click();
    p.choice('Pro Mode and Simple Mode').click();
    const [go] = p.buttons();
    go?.click();
    expect(go?.disabled).toBe(true);
    expect(p.wait()).toBe('One moment…');
    await settle();
    expect(p.sent.at(-1)?.body).toMatchObject({ link: 'answer', length: '30', mode: 'pro' });
    expect(p.title()).toBe('Approved');
    expect(p.lines().join(' ')).toContain('Their access lasts until');
    expect(p.lines()).toContain('They may use Pro Mode and Simple Mode.');
    expect(p.buttons()).toHaveLength(0);
    expect(p.radios('length')).toHaveLength(0);
    expect(p.radios('mode')).toHaveLength(0);
    expect(row(list)).toMatchObject({ Status: 'approved', Mode: 'Pro' });
    expect(list.tokenFor(PERSON)).not.toBeNull();
    // Opened again: answered already, no button.
    const again = openPage(list, approve);
    await settle();
    expect(again.title()).toBe('This request was already answered');
    expect(again.buttons()).toHaveLength(0);
  });

  it('checks days typed on the page: nothing sent until a whole number from 1 to 730; a Gmail added with a length and Pro offers those first', async () => {
    const list = new TestList({ keys });
    const { approve } = asked(list);
    const p = openPage(list, approve);
    await settle();
    const typed = p.by('typed');
    for (const wrong of ['0', '731', '2.5', '', 'ten']) {
      typed?.type_(wrong);
      expect(p.choice('A number of days').checked).toBe(true);
      p.buttons()[0]?.click();
      expect(p.wait()).toBe('Type a whole number of days from 1 to 730, or choose another length.');
      expect(p.doc.focused).toBe(typed);
    }
    expect(p.sent).toHaveLength(1);
    typed?.type_('12');
    p.buttons()[0]?.click();
    await settle();
    expect(p.sent.at(-1)?.body).toMatchObject({ link: 'answer', length: '12', mode: 'simple' });
    expect(p.title()).toBe('Approved');
    expect(row(list)?.['Access ends']).toEqual(new Date(list.t + 12 * 24 * 3_600_000));

    // Added by the owner for 45 days with Pro: the days typed, and Pro, chosen first.
    const owner = new TestList({ keys });
    ownerAdds(owner, PERSON, { length: 45, mode: 'pro' });
    const added = openPage(owner, new URL(owner.linksFor(PERSON)?.approve ?? '').hash);
    await settle();
    expect(added.choice('A number of days').checked).toBe(true);
    expect(added.by('typed')?.value).toBe('45');
    expect(added.choice('Pro Mode and Simple Mode').checked).toBe(true);
  });

  it('a Reject link: no lengths or modes, one button, and the person told', async () => {
    const list = new TestList({ keys });
    const { reject } = asked(list);
    const p = openPage(list, reject);
    await settle();
    expect(p.title()).toBe(`Reject ${PERSON}?`);
    expect(p.radios('length')).toHaveLength(0);
    expect(p.radios('mode')).toHaveLength(0);
    expect(p.buttons().map((b) => b.textContent)).toEqual(['Reject']);
    p.buttons()[0]?.click();
    await settle();
    expect(p.sent.at(-1)?.body).toEqual({
      link: 'answer',
      ...Object.fromEntries(new URLSearchParams(reject.slice(1))),
    });
    expect(p.title()).toBe('Rejected');
    expect(row(list)?.['Status']).toBe('rejected');
  });

  it('asks nothing for a link that is not complete, or when opened inside another page, and says so', async () => {
    const list = new TestList({ keys });
    const { approve } = asked(list);
    for (const hash of [
      '',
      '#',
      approve.slice(0, -1),
      approve.replace('a=approve', 'a=accept'),
      `${approve}&s=0`,
    ]) {
      const p = openPage(list, hash);
      await settle();
      expect(p.sent).toHaveLength(0);
      expect(p.title()).toBe('This link is not complete');
      expect(p.buttons()).toHaveLength(0);
    }
    const framed = openPage(list, approve, { framed: true });
    await settle();
    expect(framed.sent).toHaveLength(0);
    expect(framed.title()).toBe('Open this link on its own');
    expect(framed.buttons()).toHaveLength(0);
  });

  it('says so when the list cannot be reached: Try again reads again; pressed but not reached, Not done, and the button works again', async () => {
    const list = new TestList({ keys });
    const { approve } = asked(list);
    const p = openPage(list, approve, { reach: false });
    await settle();
    expect(p.title()).toBe('The request could not be opened');
    expect(p.lines()).toEqual([
      'The list could not be reached. Try again, or answer in Drashti on your own computer: View › Access List.',
    ]);
    expect(p.buttons().map((b) => b.textContent)).toEqual(['Try again']);
    p.reachable(true);
    p.buttons()[0]?.click();
    await settle();
    expect(p.title()).toBe(`Approve ${PERSON}?`);
    expect(p.buttons().map((b) => b.textContent)).toEqual(['Approve']);
    p.reachable(false);
    p.buttons()[0]?.click();
    await settle();
    expect(p.title()).toBe('Not done');
    expect(p.buttons()[0]?.disabled).toBe(false);
    expect(p.radios('length')).toHaveLength(10);
    expect(row(list)?.['Status']).toBe('requested');
    p.reachable(true);
    p.buttons()[0]?.click();
    await settle();
    expect(p.title()).toBe('Approved');
  });

  it('gives up waiting after a minute, and says the list could not be reached', async () => {
    const list = new TestList({ keys });
    const { approve } = asked(list);
    const p = openPage(list, approve, { reach: 'never' });
    await settle();
    expect(p.wait()).toBe('One moment…');
    expect(p.timers).toHaveLength(1);
    p.timers[0]?.();
    await settle();
    expect(p.title()).toBe('The request could not be opened');
  });

  it('a refusal (the day’s emails used up) keeps the button and the choices, to try again', async () => {
    const list = new TestList({ keys, mailQuota: 1 });
    const { approve } = asked(list);
    const p = openPage(list, approve);
    await settle();
    p.buttons()[0]?.click();
    await settle();
    expect(p.title()).toBe('Not done');
    expect(p.buttons()[0]?.disabled).toBe(false);
    expect(p.radios('mode')).toHaveLength(2);
    expect(row(list)?.['Status']).toBe('requested');
  });
});
