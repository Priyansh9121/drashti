import type { AutomaticImportNotice } from '../../shared/import';

export function automaticImportNotices(send: (notice: AutomaticImportNotice) => boolean) {
  const pending: AutomaticImportNotice[] = [];
  let ready = false;
  return {
    publish(notice: AutomaticImportNotice): void {
      if (ready) send(notice);
      else pending.push(notice);
    },
    take(): AutomaticImportNotice[] {
      ready = true;
      return pending.splice(0);
    },
  };
}
