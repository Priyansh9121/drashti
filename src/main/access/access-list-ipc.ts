import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { NO_VIEW, type AccessListResult, type AccessListSaved } from '../../shared/access-list';
import { ACCESS_ERROR_TEXT } from '../../shared/access-protocol';
import { IPC } from '../../shared/ipc';
import { handle } from '../ipc/handle';
import type { AccessList } from './access-list';

/*
 * The Access List's channels (Session 54, E4): answered for the Access List's own page only, the owner's only
 * (AccessList refuses everything while this computer is not the owner's, let in), every argument checked here.
 * Any other page (the operator window, a phone's, devtools in another window) is refused, and nothing is sent.
 */

const gmail = z.string().max(320);
const addSchema = z.object({
  gmail,
  name: z.string().max(1000),
  note: z.string().max(5000),
  approve: z.boolean(),
});
const noteSchema = z.string().max(5000);
const gmailsSchema = z.array(gmail).max(100_000);

const refused = (): AccessListResult => ({
  ok: false,
  message: ACCESS_ERROR_TEXT['not-owner'],
  view: NO_VIEW,
});
const notSaved = (): AccessListSaved => ({ ok: false, message: ACCESS_ERROR_TEXT['not-owner'] });

export function handleAccessList(o: {
  list: AccessList;
  /** The request came from the Access List's own page. */
  isPage: (event: IpcMainInvokeEvent) => boolean;
}): void {
  const { list, isPage } = o;
  handle(IPC.accessList.view, (e) => (isPage(e) ? list.view() : NO_VIEW));
  handle(IPC.accessList.refresh, (e) => (isPage(e) ? list.refresh() : NO_VIEW));
  handle(IPC.accessList.add, (e, fields) => {
    const f = addSchema.safeParse(fields);
    return isPage(e) && f.success ? list.add(f.data) : refused();
  });
  const one =
    (edit: (target: string) => Promise<AccessListResult>) =>
    (e: IpcMainInvokeEvent, target: unknown): Promise<AccessListResult> | AccessListResult => {
      const t = gmail.safeParse(target);
      return isPage(e) && t.success ? edit(t.data) : refused();
    };
  handle(
    IPC.accessList.approve,
    one((t) => list.approve(t)),
  );
  handle(
    IPC.accessList.reject,
    one((t) => list.reject(t)),
  );
  handle(
    IPC.accessList.revoke,
    one((t) => list.revoke(t)),
  );
  handle(
    IPC.accessList.regrant,
    one((t) => list.regrant(t)),
  );
  handle(IPC.accessList.note, (e, target, note) => {
    const t = gmail.safeParse(target);
    const n = noteSchema.safeParse(note);
    return isPage(e) && t.success && n.success ? list.note(t.data, n.data) : refused();
  });
  handle(IPC.accessList.exportCsv, (e, gmails) => {
    const g = gmailsSchema.safeParse(gmails);
    return isPage(e) && g.success ? list.exportCsv(g.data) : notSaved();
  });
}
