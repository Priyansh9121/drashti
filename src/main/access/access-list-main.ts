import { app, type BrowserWindow, dialog, type Rectangle } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessGrant } from '../../shared/access-protocol';
import { sw } from '../switches';
import { AccessList, ownerCalls } from './access-list';
import { handleAccessList } from './access-list-ipc';
import { AccessListWindow } from './access-list-window';
import { AccessClient, accessTarget } from './client';
import { electronTransport } from './electron-transport';
import { accessState, isLetIn, isOwner, onAccessChange } from './gate';
import { accessComputer, computerId } from './identity';
import { AccessStore, grantOf } from './store';

/*
 * View › Access List… (Session 54, E4), put together: the owner's calls (Drashti's client, signed with the way
 * in this computer keeps), the list (access-list.ts), its window and its channels, all following the gate
 * (gate.ts): only while this computer is the owner's, let in, is the menu item there and the window open. Once
 * it is not (revoked, stopped, or another Gmail let in), the window closes and what the list said is forgotten.
 *
 * The client here makes the owner's calls only; the checks every 15 s are the lock's (E2 and E3), which keeps
 * this computer's way in (store.ts): read here, never written. Both name this computer by the same id, which
 * its grant is bound to.
 */

export interface AccessListStart {
  /** Drashti's data folder (where the way in is kept) and version (sent with each call). */
  userData: string;
  version: string;
  /** The work area of the display the operator's controls are on. */
  workArea: () => Rectangle;
  /** The appearance's window colour, and its following of a window until it closes. */
  background: () => string;
  track: (win: BrowserWindow) => void;
  /**
   * The owner's computer let in, or no longer while still let in: the menu is built again, with View › Access
   * List… or without. (While this computer is not let in, the lock's own menu stands: never built again here.)
   */
  ownerChanged: () => void;
  log: (line: string) => void;
  /**
   * The lock's own client and this computer's way in as the lock keeps them, when it has them: the owner's calls
   * are then made with that client and signed with that grant. Left out, the client is made here the first time
   * the owner's calls are needed, and the way in is read from the data folder.
   */
  client?: () => Promise<AccessClient | null>;
  grant?: () => AccessGrant | null;
}

export interface AccessListControl {
  /** View › Access List…: open it (the owner's computer only), or bring it forward. */
  open(): void;
  /** Whether the menu offers it now. */
  offered(): boolean;
  close(): void;
}

export function startAccessList(o: AccessListStart): AccessListControl {
  // The client, made the first time the owner's calls are needed (this computer's id takes a moment to read):
  // never on a computer that is not the owner's, nor in the self-tests, which are never let in.
  let client: Promise<AccessClient | null> | null = null;
  const makeClient = async (): Promise<AccessClient | null> => {
    const target = accessTarget({ packaged: app.isPackaged, switches: sw });
    if (!target) return null;
    const id = await computerId({ platform: process.platform, packaged: app.isPackaged, switches: sw });
    if (!id.ok) {
      o.log(`Access List: no id for this computer (${id.reason})`);
      return null;
    }
    return new AccessClient({
      url: target.url,
      publicKey: target.publicKey,
      computer: accessComputer(id.id, o.version, process.platform),
      transport: electronTransport,
      local: target.local,
    });
  };
  const clientNow = async (): Promise<AccessClient | null> => {
    client ??= makeClient();
    const made = await client;
    // None made (this computer's id could not be read just then): tried again with the next call.
    if (!made) client = null;
    return made;
  };
  const store = new AccessStore(o.userData);
  /** The owner's way in, as kept (read afresh each time, never written here). */
  const grant = (): AccessGrant | null => {
    const kept = store.read(0);
    return kept.status === 'ok' && kept.value.owner ? grantOf(kept.value) : null;
  };

  // Each tells the other: the window's opening starts the list's asking, and each answer goes to the window.
  const listWindow: AccessListWindow = new AccessListWindow({
    workArea: o.workArea,
    background: o.background,
    track: o.track,
    opened: () => {
      list.start();
    },
    closed: () => {
      list.stop();
    },
    log: o.log,
  });
  const calls = ownerCalls(o.client ?? clientNow, o.grant ?? grant);
  const list = new AccessList({
    calls: () => (isOwner() ? calls : null),
    isOwner,
    ownerGmail: () => (isOwner() ? accessState().gmail : null),
    changed: (view) => {
      listWindow.send(view);
    },
    now: () => Date.now(),
    saveAs: async (defaultName) => {
      const options = {
        title: 'Export CSV',
        defaultPath: join(app.getPath('documents'), defaultName),
        buttonLabel: 'Save',
        filters: [{ name: 'CSV file', extensions: ['csv'] }],
      };
      const parent = listWindow.window();
      const picked = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      return picked.filePath.toLowerCase().endsWith('.csv') ? picked.filePath : `${picked.filePath}.csv`;
    },
    write: (path, text) => {
      writeFileSync(path, text, 'utf8');
    },
    log: o.log,
  });
  handleAccessList({ list, isPage: (e) => listWindow.isPage(e.sender) });

  let offered = isOwner();
  onAccessChange(() => {
    list.accessChanged();
    if (!isOwner()) listWindow.close();
    if (offered !== isOwner()) {
      offered = isOwner();
      if (isLetIn()) o.ownerChanged();
    }
  });
  return {
    open: () => {
      if (isOwner()) listWindow.open();
    },
    offered: () => isOwner(),
    close: () => {
      listWindow.close();
    },
  };
}
