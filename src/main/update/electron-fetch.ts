import type { Net } from 'electron';
import type { UpdateFetch } from './checked-fetch';

/** Shared production transport for Main and output-node updates. */
export function electronUpdateFetch(net: Pick<Net, 'fetch' | 'request'>): UpdateFetch {
  return (url, init) => net.fetch(url, init);
}
