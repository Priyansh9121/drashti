import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { win32 } from 'node:path';
import type { AccessComputer } from '../../shared/access-protocol';
import { cutText } from '../../shared/text';
import type { Switches } from '../switches';

/*
 * This computer as the access list knows it (Session 54, E1). Its computer id is the SHA-256 (hex) of
 * "drashti-access:" and the computer's own hardware id (a Mac's IOPlatformUUID, from ioreg; a Windows PC's
 * MachineGuid, from the registry), worked out at each start and never kept as the proof: a data folder copied
 * to another computer gives another id there, so the list never lets that computer in by it. Tests only: a
 * pretend hardware id (DRASHTI_TEST_HARDWARE_ID), which a packaged Drashti never reads.
 */

export const COMPUTER_ID_PREFIX = 'drashti-access:';

/** A program run with its arguments: what it printed. */
export type RunFile = (file: string, args: string[]) => Promise<string>;

export const runFile: RunFile = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(error.message));
      else resolve(stdout);
    });
  });

/** The computer id for a hardware id. */
export function computerIdOf(hardwareId: string): string {
  return createHash('sha256').update(`${COMPUTER_ID_PREFIX}${hardwareId}`, 'utf8').digest('hex');
}

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/u;

/** A Mac's IOPlatformUUID, from `ioreg -rd1 -c IOPlatformExpertDevice`. */
export function macHardwareId(ioreg: string): string | null {
  const id = /"IOPlatformUUID"\s*=\s*"([^"]+)"/u.exec(ioreg)?.[1]?.trim().toUpperCase();
  return id !== undefined && UUID.test(id) ? id : null;
}

/** A Windows PC's MachineGuid, from `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid`. */
export function windowsHardwareId(reg: string): string | null {
  const id = /MachineGuid\s+REG_SZ\s+(\S+)/u.exec(reg)?.[1]?.trim().toUpperCase();
  return id !== undefined && UUID.test(id) ? id : null;
}

export type ComputerIdResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * This computer's id: from its hardware id, or (development and the tests only) the pretend one. A computer
 * whose hardware id cannot be read has none, and cannot be let in (the lock says so).
 */
export async function computerId(o: {
  platform: NodeJS.Platform;
  packaged: boolean;
  switches: Switches;
  run?: RunFile;
  /** Windows' own folder (%SystemRoot%), where reg.exe is. */
  systemRoot?: string;
}): Promise<ComputerIdResult> {
  const pretend = o.packaged ? undefined : o.switches('DRASHTI_TEST_HARDWARE_ID');
  if (pretend !== undefined && pretend.trim() !== '') return { ok: true, id: computerIdOf(pretend.trim()) };
  const run = o.run ?? runFile;
  try {
    if (o.platform === 'darwin') {
      const id = macHardwareId(await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']));
      return id ? { ok: true, id: computerIdOf(id) } : { ok: false, reason: 'ioreg gave no IOPlatformUUID' };
    }
    if (o.platform === 'win32') {
      const reg = win32.join(o.systemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
      // The 64-bit registry's, whichever Drashti asks (MachineGuid is only there).
      const out = await run(reg, [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
        '/reg:64',
      ]);
      const id = windowsHardwareId(out);
      return id
        ? { ok: true, id: computerIdOf(id) }
        : { ok: false, reason: 'the registry gave no MachineGuid' };
    }
    return { ok: false, reason: `no hardware id on ${o.platform}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** This computer's name as the Access List shows it: its host name, without ".local", at most 60 letters. */
export function computerName(name: string = hostname()): string {
  const clean = name.replace(/\.local$/iu, '').trim();
  return clean === '' ? 'This computer' : cutText(clean, 60);
}

/** This computer, as each call to the list names it. */
export function accessComputer(id: string, version: string, platform: NodeJS.Platform): AccessComputer {
  return { id, name: computerName(), version, platform };
}
