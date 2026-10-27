import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { switchesFor } from '../switches';
import {
  accessComputer,
  computerId,
  computerIdOf,
  computerName,
  macHardwareId,
  windowsHardwareId,
  type RunFile,
} from './identity';

/*
 * This computer as the access list knows it (Session 54, E1, identity.ts): its hardware id, read as each
 * system gives it (the programs' output is made up here), and the pretend one for the tests.
 */

const MAC_UUID = '0A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D';
const IOREG = `+-o Placeholder Mac  <class IOPlatformExpertDevice, id 0x100000110, registered, matched, active, busy 0 (0 ms), retain 30>
    {
      "IOPlatformSerialNumber" = "PLACEHOLDER01"
      "IOPlatformUUID" = "${MAC_UUID}"
      "model" = <"Placeholder1,1">
    }
`;
const WIN_GUID = '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d';
const REG = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    ${WIN_GUID}

`;

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const none = switchesFor(false, {});

describe('the computer id', () => {
  it('is the SHA-256 of "drashti-access:" and the hardware id, another for another computer', () => {
    expect(computerIdOf(MAC_UUID)).toBe(sha(`drashti-access:${MAC_UUID}`));
    expect(computerIdOf(MAC_UUID.replace('0A1B', '0A1C'))).not.toBe(computerIdOf(MAC_UUID));
  });

  it('reads a Mac’s IOPlatformUUID from ioreg', async () => {
    expect(macHardwareId(IOREG)).toBe(MAC_UUID);
    expect(macHardwareId('"IOPlatformUUID" = "not-a-uuid"')).toBeNull();
    const asked: string[] = [];
    const run: RunFile = (file, args) => {
      asked.push([file, ...args].join(' '));
      return Promise.resolve(IOREG);
    };
    expect(await computerId({ platform: 'darwin', packaged: true, switches: none, run })).toEqual({
      ok: true,
      id: computerIdOf(MAC_UUID),
    });
    expect(asked).toEqual(['/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice']);
  });

  it('reads a Windows PC’s MachineGuid from the 64-bit registry, with Windows’ own reg.exe', async () => {
    expect(windowsHardwareId(REG)).toBe(WIN_GUID.toUpperCase());
    const asked: string[][] = [];
    const run: RunFile = (file, args) => {
      asked.push([file, ...args]);
      return Promise.resolve(REG);
    };
    expect(
      await computerId({ platform: 'win32', packaged: true, switches: none, run, systemRoot: 'D:\\Win' }),
    ).toEqual({
      ok: true,
      id: computerIdOf(WIN_GUID.toUpperCase()),
    });
    expect(asked).toEqual([
      [
        'D:\\Win\\System32\\reg.exe',
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
        '/reg:64',
      ],
    ]);
  });

  it('is none when the hardware id cannot be read', async () => {
    const fails: RunFile = () => Promise.reject(new Error('Placeholder: the program could not run'));
    expect(await computerId({ platform: 'darwin', packaged: true, switches: none, run: fails })).toEqual({
      ok: false,
      reason: 'Placeholder: the program could not run',
    });
    const empty: RunFile = () => Promise.resolve('');
    expect(await computerId({ platform: 'win32', packaged: true, switches: none, run: empty })).toMatchObject(
      { ok: false },
    );
    expect(await computerId({ platform: 'linux', packaged: true, switches: none, run: empty })).toMatchObject(
      { ok: false },
    );
  });

  it('is the pretend one in development and the tests, never in a packaged Drashti', async () => {
    const env = { DRASHTI_TEST_HARDWARE_ID: 'placeholder-hardware-1' };
    const run: RunFile = () => Promise.resolve(IOREG);
    expect(
      await computerId({ platform: 'darwin', packaged: false, switches: switchesFor(false, env), run }),
    ).toEqual({
      ok: true,
      id: computerIdOf('placeholder-hardware-1'),
    });
    // Packaged: neither the switches nor this module read it.
    expect(
      await computerId({ platform: 'darwin', packaged: true, switches: switchesFor(true, env), run }),
    ).toEqual({
      ok: true,
      id: computerIdOf(MAC_UUID),
    });
    expect(
      await computerId({
        platform: 'darwin',
        packaged: true,
        switches: (n) => (env as Record<string, string>)[n],
        run,
      }),
    ).toEqual({ ok: true, id: computerIdOf(MAC_UUID) });
  });
});

describe('the computer’s name', () => {
  it('is its host name without .local, at most 60 letters, never empty', () => {
    expect(computerName('Placeholder-Mac.local')).toBe('Placeholder-Mac');
    expect(computerName('')).toBe('This computer');
    expect(computerName('x'.repeat(80))).toHaveLength(60);
    expect(accessComputer('a'.repeat(64), '1.0.0-alpha.13', 'win32')).toMatchObject({
      id: 'a'.repeat(64),
      version: '1.0.0-alpha.13',
      platform: 'win32',
    });
  });
});
