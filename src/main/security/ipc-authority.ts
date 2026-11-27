import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { ipcChannelAllowed, type IpcPage } from '../../shared/ipc-policy';

interface Assignment {
  page: IpcPage;
  document: string;
}
const assigned = new WeakMap<WebContents, Assignment>();

/** Query strings and anchors carry page data, never authority. Credentials are never an app document. */
function documentOf(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Called only at Main's loadPage boundary, before the preload can request anything. A role cannot change. */
export function assignIpcPage(contents: WebContents, page: IpcPage, href: string): void {
  const document = documentOf(href);
  const previous = assigned.get(contents);
  if (document === null || (previous && (previous.page !== page || previous.document !== document)))
    throw new Error('Refused IPC page reassignment.');
  assigned.set(contents, { page, document });
}

/** An app-created contents object's current main frame, still on its assigned document, using its own channel. */
export function ipcRequestAllowed(event: IpcMainInvokeEvent | IpcMainEvent, channel: string): boolean {
  const contents = event.sender;
  const assignment = assigned.get(contents);
  if (!assignment || contents.isDestroyed() || event.senderFrame !== contents.mainFrame) return false;
  return (
    documentOf(event.senderFrame.url) === assignment.document &&
    documentOf(contents.getURL()) === assignment.document &&
    ipcChannelAllowed(assignment.page, channel)
  );
}
