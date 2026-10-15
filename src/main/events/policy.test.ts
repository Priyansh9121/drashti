import { describe, expect, it } from 'vitest';
import { checkTarget, type Resolve } from './policy';

/*
 * Where events out may go (Session 28): the local network unless allowed, https on the internet, every
 * address a name resolves to checked, and the request pinned to the address checked; tests to 127.0.0.1
 * only. Names resolve through a stand-in: nothing here asks the internet.
 */

const names: Record<string, string[]> = {
  'n8n.local': ['192.168.1.20'],
  'both.example': ['192.168.1.21', '203.0.113.9'],
  'hook.example': ['203.0.113.10'],
  localhost: ['127.0.0.1'],
};
const resolve: Resolve = (host) => {
  const found = names[host];
  return found
    ? Promise.resolve(found.map((address) => ({ address, family: 4 })))
    : Promise.reject(new Error('ENOTFOUND'));
};
const local = { allowInternet: false, onlyThisComputer: false, resolve };
const internet = { allowInternet: true, onlyThisComputer: false, resolve };

describe('where events out may go', () => {
  it('to the local network: an address and a name resolving there, pinned to the address checked', async () => {
    expect(await checkTarget('http://192.168.1.20:5678/webhook/x', local)).toMatchObject({
      ok: true,
      ip: '192.168.1.20',
    });
    expect(await checkTarget('http://n8n.local:5678/webhook/x', local)).toMatchObject({
      ok: true,
      ip: '192.168.1.20',
    });
    expect(await checkTarget('http://[fd00::5]/x', local)).toMatchObject({
      ok: true,
      ip: 'fd00::5',
      family: 6,
    });
  });

  it('not to the internet unless allowed, and then over https only; a name with any public address is refused', async () => {
    expect(await checkTarget('https://hook.example/x', local)).toMatchObject({ ok: false });
    expect(await checkTarget('http://both.example/x', local)).toMatchObject({ ok: false });
    expect(await checkTarget('https://203.0.113.10/x', local)).toMatchObject({ ok: false });
    expect(await checkTarget('http://hook.example/x', internet)).toMatchObject({
      ok: false,
      reason: 'An address on the internet must start https://.',
    });
    expect(await checkTarget('https://hook.example/x', internet)).toMatchObject({
      ok: true,
      ip: '203.0.113.10',
    });
  });

  it('never to "any" or a group address, never a name it cannot find, never another scheme', async () => {
    expect(await checkTarget('http://0.0.0.0/x', internet)).toMatchObject({ ok: false });
    expect(await checkTarget('https://224.0.0.1/x', internet)).toMatchObject({ ok: false });
    expect(await checkTarget('http://nowhere.example/x', local)).toMatchObject({ ok: false });
    expect(await checkTarget('ftp://192.168.1.20/x', local)).toMatchObject({ ok: false });
  });

  it('a test goes only to 127.0.0.1, refused loudly otherwise', async () => {
    const test = { allowInternet: false, onlyThisComputer: true, resolve };
    expect(await checkTarget('http://127.0.0.1:9/x', test)).toMatchObject({ ok: true });
    expect(await checkTarget('http://localhost:9/x', test)).toMatchObject({ ok: true, ip: '127.0.0.1' });
    expect(await checkTarget('http://192.168.1.20/x', test)).toMatchObject({ ok: false, loud: true });
    expect(await checkTarget('https://hook.example/x', { ...test, allowInternet: true })).toMatchObject({
      ok: false,
      loud: true,
    });
  });
});
