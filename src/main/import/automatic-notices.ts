import type { AutomaticImportNotice } from '../../shared/import';
import { isAppUrl } from '../windows/navigation';

const MAX_PENDING_NOTICES = 50;

export function automaticImportNotices(send: (notice: AutomaticImportNotice) => boolean) {
  const pending: AutomaticImportNotice[] = [];
  let ready = false;
  return {
    publish: (notice: AutomaticImportNotice): void => {
      if (ready && send(notice)) return;
      ready = false;
      if (pending.length === MAX_PENDING_NOTICES) pending.shift();
      pending.push(notice);
    },
    pause(): void {
      ready = false;
    },
    take(): AutomaticImportNotice[] {
      ready = true;
      return pending.splice(0);
    },
  };
}

/**
 * Whether a navigation the operator window starts (its did-start-navigation) is Drashti's own page loading again: a
 * reload, or the watchdog's after a crash. Only then do the automatic notices wait for the new page's ask (`pause`).
 * Its own page is what the window's navigation guard lets in (isAppUrl); the guard blocks any other address and the page
 * stays, so pausing for one would hold every notice until the next reload (Session 57 review, L1). A move within the
 * page (its address's #) and a frame's navigation load no new page.
 */
export function loadsOperatorPageAgain(
  navigation: { url: string; isMainFrame: boolean; isSameDocument: boolean },
  app: { devServerUrl?: string | undefined; rendererDir: string },
): boolean {
  return navigation.isMainFrame && !navigation.isSameDocument && isAppUrl(navigation.url, app);
}
