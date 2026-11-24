import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { MAX_DISPLAY_COPY_BYTES } from '../../shared/pictures';
import { DisplayBlobFiles } from './display-blob-file';

class NativeFile extends EventEmitter {
  received = 0;
  destination = '';
  chain: string[];
  readonly cancel = vi.fn();
  readonly setSavePath = vi.fn((path: string) => {
    this.destination = path;
  });
  constructor(
    readonly url: string,
    public total: number,
  ) {
    super();
    this.chain = [url];
  }
  getURL() {
    return this.url;
  }
  getURLChain() {
    return this.chain;
  }
  getTotalBytes() {
    return this.total;
  }
  getReceivedBytes() {
    return this.received;
  }
  getSavePath() {
    return this.destination;
  }
  finish(state = 'completed') {
    this.emit('done', {}, state);
  }
}

const services: DisplayBlobFiles[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function setup() {
  const events = new EventEmitter();
  const pages = events as unknown as Session;
  const windowEvents = new EventEmitter();
  const downloadURL = vi.fn();
  const frame = { origin: 'null' };
  const contents = Object.assign(windowEvents, {
    id: 7,
    mainFrame: frame,
    session: pages,
    isDestroyed: () => false,
    getURL: () => 'file:///generated/display-copy.html',
    downloadURL,
  }) as unknown as WebContents;
  const files = new DisplayBlobFiles(pages);
  services.push(files);
  const blob = { url: `blob:null/${randomUUID()}`, bytes: 257 };
  const destination = join(tmpdir(), `generated-display-${randomUUID()}.part`);
  const abort = new AbortController();
  const start = () => {
    const saved = files.save(contents, blob, destination, abort.signal);
    void saved.catch(() => undefined);
    return saved;
  };
  const dispatch = (item: NativeFile, sender: WebContents | undefined = contents) => {
    const preventDefault = vi.fn();
    events.emit('will-download', { preventDefault }, item, sender);
    return preventDefault;
  };
  const finish = (item: NativeFile) => {
    item.received = blob.bytes;
    item.finish();
  };
  return {
    files,
    pages,
    events,
    contents,
    frame,
    downloadURL,
    blob,
    destination,
    abort,
    start,
    dispatch,
    finish,
  };
}

it('permits only the exact native file and resolves after its complete byte count and terminal event', async () => {
  const t = setup();
  const saved = t.start();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  let settled = false;
  void saved.then(() => {
    settled = true;
  });
  expect(t.dispatch(item)).not.toHaveBeenCalled();
  expect(t.downloadURL).toHaveBeenCalledExactlyOnceWith(t.blob.url);
  expect(item.setSavePath).toHaveBeenCalledExactlyOnceWith(t.destination);
  await Promise.resolve();
  expect(settled).toBe(false);
  t.finish(item);
  await saved;
  expect(settled).toBe(true);
  expect(item.listenerCount('updated')).toBe(0);
  expect(item.listenerCount('done')).toBe(0);
  expect(t.contents.listenerCount('destroyed')).toBe(0);
});

it.each([0, -1, 1.5, NaN, Infinity, MAX_DISPLAY_COPY_BYTES + 1])(
  'refuses unsafe declared length %s before starting a native operation',
  async (bytes) => {
    const t = setup();
    await expect(
      t.files.save(t.contents, { ...t.blob, bytes }, t.destination, t.abort.signal),
    ).rejects.toThrow();
    expect(t.downloadURL).not.toHaveBeenCalled();
  },
);

it.each(['https://example.invalid/generated.png', 'file:///generated/result.png', 'blob:null/not-a-uuid'])(
  'refuses an unowned address %s without fetching it',
  async (url) => {
    const t = setup();
    await expect(
      t.files.save(t.contents, { ...t.blob, url }, t.destination, t.abort.signal),
    ).rejects.toThrow();
    expect(t.downloadURL).not.toHaveBeenCalled();
  },
);

it('refuses a page from another Session before starting', async () => {
  const t = setup();
  const otherDownloadURL = vi.fn();
  const other = Object.assign(new EventEmitter(), {
    id: 9,
    session: {} as Session,
    isDestroyed: () => false,
    getURL: () => t.contents.getURL(),
    downloadURL: otherDownloadURL,
  }) as unknown as WebContents;
  await expect(t.files.save(other, t.blob, t.destination, t.abort.signal)).rejects.toThrow();
  expect(otherDownloadURL).not.toHaveBeenCalled();
});

it('denies other senders and URLs while preserving the one permitted operation', async () => {
  const t = setup();
  const saved = t.start();
  const foreign = new NativeFile(t.blob.url, t.blob.bytes);
  expect(t.dispatch(foreign, { id: 99 } as WebContents)).toHaveBeenCalledOnce();
  expect(foreign.setSavePath).not.toHaveBeenCalled();
  const unrelated = new NativeFile(`blob:null/${randomUUID()}`, t.blob.bytes);
  expect(t.dispatch(unrelated)).toHaveBeenCalledOnce();
  expect(unrelated.setSavePath).not.toHaveBeenCalled();
  const owned = new NativeFile(t.blob.url, t.blob.bytes);
  expect(t.dispatch(owned)).not.toHaveBeenCalled();
  t.finish(owned);
  await saved;
});

it('rejects mismatching advertised length before setting a save path', async () => {
  const t = setup();
  const saved = t.start();
  const item = new NativeFile(t.blob.url, t.blob.bytes + 1);
  expect(t.dispatch(item)).toHaveBeenCalledOnce();
  await expect(saved).rejects.toThrow();
  expect(item.setSavePath).not.toHaveBeenCalled();
});

it('refuses another save while the current owned operation is pending', async () => {
  const t = setup();
  const saved = t.start();
  await expect(t.files.save(t.contents, t.blob, t.destination, t.abort.signal)).rejects.toThrow();
  expect(t.downloadURL).toHaveBeenCalledOnce();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  t.dispatch(item);
  t.finish(item);
  await saved;
});

it('denies a duplicate native item and closes the original writer before rejecting', async () => {
  const t = setup();
  const saved = t.start();
  const original = new NativeFile(t.blob.url, t.blob.bytes);
  t.dispatch(original);
  const duplicate = new NativeFile(t.blob.url, t.blob.bytes);
  expect(t.dispatch(duplicate)).toHaveBeenCalledOnce();
  expect(duplicate.setSavePath).not.toHaveBeenCalled();
  expect(original.cancel).toHaveBeenCalledOnce();
  original.finish('cancelled');
  await expect(saved).rejects.toThrow();
});

it.each(['overrun', 'interrupted'])(
  'cancels %s and waits until the native writer is terminal',
  async (reason) => {
    const t = setup();
    const saved = t.start();
    let settled = false;
    void saved.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const item = new NativeFile(t.blob.url, t.blob.bytes);
    t.dispatch(item);
    if (reason === 'overrun') item.received = t.blob.bytes + 1;
    item.emit('updated', {}, reason === 'interrupted' ? 'interrupted' : 'progressing');
    expect(item.cancel).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    item.finish('cancelled');
    await expect(saved).rejects.toThrow();
    expect(settled).toBe(true);
  },
);

it.each(['abort', 'worker gone', 'closed'])(
  'closes the native writer before rejecting an operation %s',
  async (reason) => {
    const t = setup();
    const saved = t.start();
    let settled = false;
    void saved.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const item = new NativeFile(t.blob.url, t.blob.bytes);
    t.dispatch(item);
    if (reason === 'abort') t.abort.abort();
    else if (reason === 'worker gone') t.contents.emit('destroyed');
    else t.files.close();
    expect(item.cancel).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    item.finish('cancelled');
    await expect(saved).rejects.toThrow();
  },
);

it('denies a late native request after pre-start cancellation', async () => {
  const t = setup();
  const saved = t.start();
  t.abort.abort();
  await expect(saved).rejects.toThrow();
  const late = new NativeFile(t.blob.url, t.blob.bytes);
  expect(t.dispatch(late)).toHaveBeenCalledOnce();
  expect(late.setSavePath).not.toHaveBeenCalled();
});

it.each(['truncated', 'wrong path', 'failed'])('refuses a terminal file that is %s', async (reason) => {
  const t = setup();
  const saved = t.start();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  t.dispatch(item);
  item.received = reason === 'truncated' ? t.blob.bytes - 1 : t.blob.bytes;
  if (reason === 'wrong path') item.destination += '.other';
  item.finish(reason === 'failed' ? 'interrupted' : 'completed');
  await expect(saved).rejects.toThrow();
});

it('keeps the private Session closed to downloads after shutdown', () => {
  const t = setup();
  t.files.close();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  expect(t.dispatch(item)).toHaveBeenCalledOnce();
  expect(item.setSavePath).not.toHaveBeenCalled();
});

it('accepts the exact Blob from a file-backed worker’s committed file origin', async () => {
  const t = setup();
  t.frame.origin = 'file://';
  t.blob.url = `blob:file:///${randomUUID()}`;
  // Node's URL-origin serialization is not the browser's committed file origin.
  expect(new URL(t.contents.getURL()).origin).toBe('null');
  const saved = t.start();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  const prevented = t.dispatch(item);
  t.finish(item);
  await expect(saved).resolves.toBeUndefined();
  expect(prevented).not.toHaveBeenCalled();
  expect(t.downloadURL).toHaveBeenCalledExactlyOnceWith(t.blob.url);
  expect(item.setSavePath).toHaveBeenCalledExactlyOnceWith(t.destination);
});

it('rejects an opaque-origin Blob when the worker’s committed origin is file', async () => {
  const t = setup();
  t.frame.origin = 'file://';
  const saved = t.start();
  // Complete a wrongly started write so the red fails on identity, never on a timeout.
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  t.dispatch(item);
  t.finish(item);
  await expect(saved).rejects.toThrow('The display Blob is not this worker’s to save.');
  expect(t.downloadURL).not.toHaveBeenCalled();
  expect(item.setSavePath).not.toHaveBeenCalled();
});

it('rejects a Blob when the committed frame has no live origin', async () => {
  const t = setup();
  t.frame.origin = '';
  const saved = t.start();
  const item = new NativeFile(t.blob.url, t.blob.bytes);
  t.dispatch(item);
  t.finish(item);
  await expect(saved).rejects.toThrow('The display Blob is not this worker’s to save.');
  expect(t.downloadURL).not.toHaveBeenCalled();
  expect(item.setSavePath).not.toHaveBeenCalled();
});

it.each(['https://other.invalid', 'https://generated.invalid.evil', 'null', 'file://'])(
  'refuses Blob origin %s when the trusted sender origin differs',
  async (origin) => {
    const t = setup();
    t.frame.origin = 'https://generated.invalid';
    t.blob.url = `blob:${origin}/${randomUUID()}`;
    await expect(t.start()).rejects.toThrow('The display Blob is not this worker’s to save.');
    expect(t.downloadURL).not.toHaveBeenCalled();
  },
);

it('refuses trailing bytes after the browser UUID even when the origin equals the sender', async () => {
  const t = setup();
  t.frame.origin = 'file://';
  t.blob.url = `blob:file:///${randomUUID()}\n`;
  await expect(t.start()).rejects.toThrow('The display Blob is not this worker’s to save.');
  expect(t.downloadURL).not.toHaveBeenCalled();
});
