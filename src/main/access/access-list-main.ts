import { app, type BrowserWindow, dialog, type Rectangle } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccessGrant } from '../../shared/access-protocol';
import { AccessList, ownerCalls } from './access-list';
import { handleAccessList } from './access-list-ipc';
import { AccessListWindow } from './access-list-window';
import type { AccessClient } from './client';
import { accessState, isLetIn, isOwner, onAccessChange } from './gate';

/*
 * View › Access List… (Session 54, E4), put together: the owner's calls (the lock's own client, signed with the way
 * in the lock keeps), the list (access-list.ts), its window and its channels, all following the gate (gate.ts):
 * only while this computer is the owner's, let in, is the menu item there and the window open. Once it is not
 * (revoked, stopped, or another Gmail let in), the window closes and what the list said is forgotten.
 */

export interface AccessListStart {
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
  /** The lock's client (behind-the-lock.ts), with which the owner's calls are made: one client for every call. */
  client: () => Promise<AccessClient | null>;
  /** This computer's way in as the lock keeps it, which signs them. */
  grant: () => AccessGrant | null;
}

export interface AccessListControl {
  /** View › Access List…: open it (the owner's computer only), or bring it forward. */
  open(): void;
  /** Whether the menu offers it now. */
  offered(): boolean;
  close(): void;
}

export function startAccessList(o: AccessListStart): AccessListControl {
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
  const calls = ownerCalls(o.client, o.grant);
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
