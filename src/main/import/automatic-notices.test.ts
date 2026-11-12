import { expect, it, vi } from 'vitest';
import { automaticImportNotices } from './automatic-notices';

it('keeps a notice when the old operator page goes away before it can receive it', () => {
  const send = vi.fn(() => false);
  const notices = automaticImportNotices(send);
  expect(notices.take()).toEqual([]);
  const notice = { runId: 'placeholder-import' };
  notices.publish(notice);
  expect(send).toHaveBeenCalledOnce();
  expect(notices.take()).toEqual([notice]);
  expect(notices.take()).toEqual([]);
});

it('keeps the newest 50 notices until the operator page is ready', () => {
  const send = vi.fn(() => true);
  const notices = automaticImportNotices(send);
  const all = Array.from({ length: 55 }, (_, i) => ({ runId: 'placeholder-' + String(i) }));
  for (const notice of all) notices.publish(notice);
  expect(send).not.toHaveBeenCalled();
  expect(notices.take()).toEqual(all.slice(-50));
});
