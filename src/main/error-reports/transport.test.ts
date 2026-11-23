import { describe, expect, it } from 'vitest';
import type { AccessTransport } from '../access/client';
import { sendErrorReport } from './transport';
const config = {
  endpoint: 'https://script.google.com/macros/s/placeholder-install/exec',
  installId: 'b'.repeat(32),
  secret: 'd'.repeat(64),
};
const id = 'e'.repeat(32);
const body = JSON.stringify({ payload: JSON.stringify({ id }) });
describe('automatic report transport (fake only)', () => {
  it('posts once, reads Google response redirect with GET and no secret, checks matching receipt', async () => {
    const calls: Parameters<AccessTransport>[0][] = [];
    const transport: AccessTransport = (call) => {
      calls.push(call);
      return Promise.resolve(
        calls.length === 1
          ? {
              status: 302,
              location: 'https://script.googleusercontent.com/macros/echo?placeholder=1',
              text: () => Promise.resolve(''),
              cancel: () => undefined,
            }
          : {
              status: 200,
              location: null,
              text: () => Promise.resolve(JSON.stringify({ ok: true, id })),
              cancel: () => undefined,
            },
      );
    };
    expect(await sendErrorReport(transport, config, body, new AbortController().signal)).toBe(true);
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['POST', body],
      ['GET', null],
    ]);
  });
  it('refuses a redirect to any other host or path and a mismatched acknowledgement', async () => {
    for (const location of [
      'http://script.googleusercontent.com/macros/echo',
      'https://example.com/macros/echo',
      'https://script.googleusercontent.com/other',
      'https://script.googleusercontent.com:444/macros/echo',
    ]) {
      let calls = 0;
      const transport: AccessTransport = () => {
        calls++;
        return Promise.resolve({
          status: 302,
          location,
          text: () => Promise.resolve(''),
          cancel: () => undefined,
        });
      };
      expect(await sendErrorReport(transport, config, body, new AbortController().signal)).toBe(false);
      expect(calls).toBe(1);
    }
    const wrong: AccessTransport = () =>
      Promise.resolve({
        status: 200,
        location: null,
        text: () => Promise.resolve(JSON.stringify({ ok: true, id: 'f'.repeat(32) })),
        cancel: () => undefined,
      });
    expect(await sendErrorReport(wrong, config, body, new AbortController().signal)).toBe(false);
  });
});
