import type { AutomaticImportNotice } from '../../shared/import';

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
