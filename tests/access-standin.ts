import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AccessComputer, AccessGrant } from '../src/shared/access-protocol';
import {
  callBody,
  core,
  linkParams,
  PLACEHOLDER_APPROVER,
  readAnswer,
  TestList,
  type LinkPage,
  type TestListOptions,
} from './access-core';

/*
 * A stand-in for the access list (Session 54, E1), on 127.0.0.1 only, for every test that starts Drashti:
 * the list's own access-list/core.js behind Node's HTTP server, with the Sheet in memory, a mailbox the test
 * reads (a token, an Approve link), the list's clock that a test moves, and a signing key made for the test.
 * Drashti is pointed at it by a test switch that a packaged Drashti ignores (src/main/access/client.ts).
 *
 * It answers as Google's web app does: a POST to …/exec is answered with a redirect to a one-time address
 * (Google's is on script.googleusercontent.com), whose GET gives the answer. An Approve or Reject link opens
 * a page with one button, as the list's own page has. A test can also make it say nothing, answer an error,
 * leave its answers unsigned, or change them on the way (`tamper`).
 */

const EXEC = '/macros/s/stand-in/exec';
const LINK = '/macros/s/stand-in/link';
const ECHO = '/macros/echo';

export type StandInMode = 'answer' | 'silent' | 'error' | 'unsigned';

export interface AccessStandIn {
  /** The web app's address, as Drashti calls it. */
  url: string;
  /** The stand-in's public key, SPKI in base64 (what Drashti has built in, for the real list). */
  publicKey: string;
  /** The owner's (the approver's) placeholder address. */
  approver: string;
  /** The list itself: its Sheet (a test may type in it), mailbox, clock and limits. */
  list: TestList;
  /** Every call's op, in order (as the list read it). */
  calls: string[];
  /** As the list answers; never (Drashti hears nothing); 503; or unsigned. */
  mode: StandInMode;
  /** Answer each POST with Google's redirect (the default), or at once. */
  redirect: boolean;
  /** Change each answer on its way (a forged or replayed answer). */
  tamper: ((answer: { payload: string; sig: string }) => { payload: string; sig: string }) | null;
  /** The button on an Approve or Reject link's page, pressed (as the approver would). */
  press(link: string): LinkPage;
  /**
   * A grant for this Gmail on this computer, made the real way (asked for, approved by the link, the
   * token from its email used; the approver's own through Let me in), for a test that starts Drashti let in.
   */
  grant(gmail: string, computer: AccessComputer): AccessGrant;
  close(): Promise<void>;
}

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function linkHtml(page: LinkPage): string {
  const lines = page.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  const form =
    page.button && page.params
      ? `<form method="post" action="${LINK}">${Object.entries(page.params)
          .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
          .join('')}<button type="submit">${escapeHtml(page.button)}</button></form>`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Drashti access list</title></head><body data-kind="${escapeHtml(page.kind)}"><h1>${escapeHtml(page.title)}</h1>${lines}${form}</body></html>`;
}

async function body(req: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of req as AsyncIterable<Buffer>) {
    text += chunk.toString('utf8');
    if (text.length > 64 * 1024) throw new Error('Too long');
  }
  return text;
}

/** Start a stand-in list on 127.0.0.1, set up as the owner's would be after Drashti › Set up…. */
export async function accessStandIn(o: TestListOptions = {}): Promise<AccessStandIn> {
  let base = '';
  const list = new TestList({ approver: PLACEHOLDER_APPROVER, ...o });
  const echoes = new Map<string, string>();
  const held = new Set<ServerResponse>();
  const ownerComputer: AccessComputer = {
    id: randomBytes(32).toString('hex'),
    name: 'Placeholder owner computer',
    version: '1.0.0-alpha.13',
    platform: 'darwin',
  };
  let ownerGrant: AccessGrant | null = null;

  const answer = (text: string): string => {
    let a = list.handle(text);
    try {
      const op = (JSON.parse(a.payload) as { op?: unknown }).op;
      standIn.calls.push(typeof op === 'string' ? op : '');
    } catch {
      standIn.calls.push('');
    }
    if (standIn.mode === 'unsigned') a = { ...a, sig: '' };
    if (standIn.tamper) a = standIn.tamper(a);
    return JSON.stringify(a);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      if (standIn.mode === 'silent') {
        held.add(res);
        res.on('close', () => held.delete(res));
        return;
      }
      if (standIn.mode === 'error') {
        res.writeHead(503, { 'content-type': 'text/html' });
        res.end('<p>Placeholder: the service is unavailable.</p>');
        return;
      }
      if (req.method === 'POST' && url.pathname === EXEC) {
        const text = answer(await body(req));
        if (!standIn.redirect) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(text);
          return;
        }
        const key = randomBytes(12).toString('hex');
        echoes.set(key, text);
        res.writeHead(302, { location: `${base}${ECHO}?user_content_key=${key}` });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === ECHO) {
        const key = url.searchParams.get('user_content_key') ?? '';
        const text = echoes.get(key);
        echoes.delete(key);
        res.writeHead(text === undefined ? 404 : 200, { 'content-type': 'application/json' });
        res.end(text ?? '');
        return;
      }
      if (req.method === 'GET' && url.pathname === EXEC) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(linkHtml(core.linkPage(list.env, Object.fromEntries(url.searchParams.entries()))));
        return;
      }
      if (req.method === 'POST' && url.pathname === LINK) {
        const params = Object.fromEntries(new URLSearchParams(await body(req)).entries());
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(linkHtml(core.answerLink(list.env, params)));
        return;
      }
      res.writeHead(404);
      res.end();
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  list.props.webAppUrl = `${base}${EXEC}`;

  const call = (
    op: string,
    computer: AccessComputer,
    fields: Record<string, unknown>,
    grant?: AccessGrant,
  ) => {
    const { body: b } = callBody(op, computer, fields, grant);
    return readAnswer(list.handle(JSON.stringify(b)), list.keys.publicKey);
  };
  const redeem = (gmail: string, computer: AccessComputer): AccessGrant => {
    const token = list.tokenFor(gmail);
    const a = call('redeem', computer, { gmail, token: token ?? '' });
    if (!a.ok) throw new Error(`The stand-in could not let ${gmail} in: ${String(a.error)}`);
    return { gmail, grantId: String(a['grantId']), secret: String(a['secret']) };
  };

  const standIn: AccessStandIn = {
    url: `${base}${EXEC}`,
    publicKey: list.keys.publicKey,
    approver: list.props.approverEmail,
    list,
    calls: [],
    mode: 'answer',
    redirect: true,
    tamper: null,
    press: (link) => core.answerLink(list.env, linkParams(link)),
    grant: (gmail, computer) => {
      if (core.gmailKey(gmail) === core.gmailKey(list.props.approverEmail)) {
        core.letOwnerIn(list.env);
        return redeem(gmail, computer);
      }
      const asked = call('request', computer, { gmail });
      if (asked.ok) {
        const links = list.linksFor(gmail);
        if (!links) throw new Error(`No Approve link for ${gmail}`);
        core.answerLink(list.env, linkParams(links.approve));
      } else {
        // Approved already, with a computer in: the owner gives access again.
        ownerGrant ??= standIn.grant(list.props.approverEmail, ownerComputer);
        const a = call('regrant', ownerComputer, { at: list.t, target: gmail }, ownerGrant);
        if (!a.ok) throw new Error(`The stand-in could not give ${gmail} access again: ${String(a.error)}`);
      }
      return redeem(gmail, computer);
    },
    close: () =>
      new Promise((resolve) => {
        for (const res of held) res.destroy();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  return standIn;
}
