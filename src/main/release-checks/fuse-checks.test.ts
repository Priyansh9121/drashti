import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import electron from 'electron';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fusesAsWanted, runAsNodeRefused } from '../../../scripts/fuse-checks.mjs';

/*
 * A packaged Drashti's fuses (Sessions 31–36, REL-7), and the proof that it no longer runs as Node. The
 * Electron the repository builds with is as Electron ships it: a script runs in it as Node, and its fuses
 * say so (what the installer check refused before electron-builder.yml turned them off). A copy of the file
 * that holds the fuses, flipped as electron-builder.yml says, reads as a packaged Drashti's must.
 */

/** The Electron binary (in unit tests, `electron` is its path), and the file holding its fuses (copied). */
const binary = electron as unknown as string;
const fuseFile =
  process.platform === 'darwin'
    ? join(dirname(binary), '..', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')
    : binary;

/** electron-builder.yml's electronFuses, read as the fuses @electron/fuses flips. */
function configuredFuses(): Record<number, boolean> {
  const yml = readFileSync(join(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8');
  const block = /^electronFuses:\n((?: {2}.*\n)+)/mu.exec(yml)?.[1] ?? '';
  const said = (key: string) => {
    const m = new RegExp(`^ {2}${key}: (true|false)$`, 'mu').exec(block);
    return m ? m[1] === 'true' : undefined;
  };
  const fuses: Record<number, boolean> = {};
  for (const [key, fuse] of [
    ['runAsNode', FuseV1Options.RunAsNode],
    ['enableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable],
    ['enableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments],
    ['grantFileProtocolExtraPrivileges', FuseV1Options.GrantFileProtocolExtraPrivileges],
  ] as const) {
    const value = said(key);
    if (value !== undefined) fuses[fuse] = value;
  }
  return fuses;
}

describe('a packaged Drashti’s fuses (REL-7)', () => {
  it('the Electron as it ships runs a script as Node, and its fuses say so', async () => {
    const { PATH, HOME, SystemRoot, TEMP, TMP } = process.env;
    const ran = await runAsNodeRefused(binary, [], { PATH, HOME, SystemRoot, TEMP, TMP }, 60_000);
    expect(ran).toEqual({ ok: false, why: 'ELECTRON_RUN_AS_NODE=1 still runs it as Node: the script ran' });
    // Read through the binary (inside a Mac's .app, @electron/fuses finds the framework that holds them).
    const fuses = await fusesAsWanted(binary);
    expect(fuses.ok).toBe(false);
    expect(fuses.why).toContain('running as Node (ELECTRON_RUN_AS_NODE) is still on');
  }, 120_000);

  it('flipped as electron-builder.yml says, its fuses are as a packaged Drashti’s must be', async () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'drashti-fuses-')), 'electron-fuses');
    copyFileSync(fuseFile, copy);
    await flipFuses(copy, { version: FuseVersion.V1, ...configuredFuses() });
    expect(await fusesAsWanted(copy)).toEqual({
      ok: true,
      why: "its fuses: running as Node, NODE_OPTIONS and --inspect off; file:// pages' privileges kept",
    });
  }, 120_000);
});
