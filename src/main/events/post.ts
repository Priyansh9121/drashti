import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { TryResult } from './delivery';

/*
 * One POST of events out (Session 28), from the events worker: to the address the policy checked (the
 * name's own lookup is replaced by that address, so the request cannot go anywhere else), with the name kept
 * for the Host header and for https's certificate check; never following a redirect; given up after 15 s.
 * The answer's status and Date are all that is read: the body is not.
 */

export const POST_TIMEOUT_MS = 15_000;

export interface PostRequest {
  url: URL;
  /** The address checked, which the connection goes to. */
  ip: string;
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
  /** Tests only: the certificate authority of a local https stand-in. */
  ca?: string;
}

export function post(req: PostRequest): Promise<TryResult> {
  const pinned: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: req.ip, family: req.family }]);
    else callback(null, req.ip, req.family);
  };
  const secure = req.url.protocol === 'https:';
  const host = req.url.hostname.replace(/^\[|\]$/gu, '');
  const send = secure ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: TryResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const r = send(
      req.url,
      {
        method: 'POST',
        lookup: pinned,
        agent: false,
        headers: {
          ...req.headers,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(req.body)),
          'user-agent': 'Drashti',
        },
        // https checks the certificate against the name (an address's own name is never sent as SNI).
        ...(secure && isIP(host) === 0 ? { servername: host } : {}),
        ...(secure && req.ca ? { ca: req.ca } : {}),
      },
      (res: IncomingMessage) => {
        const date = res.headers.date;
        done({ status: res.statusCode ?? 0, ...(date ? { date } : {}) });
        // Nothing more is wanted from it.
        res.destroy();
      },
    );
    r.setTimeout(POST_TIMEOUT_MS, () => {
      r.destroy(new Error('timed out'));
    });
    r.on('error', (error: NodeJS.ErrnoException) => {
      done({ error: error.code ?? error.message });
    });
    r.end(req.body);
  });
}
