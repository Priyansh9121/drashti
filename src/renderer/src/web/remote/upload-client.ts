import {
  UPLOAD_PIECE_FIRST,
  UPLOAD_PIECE_MAX,
  UPLOAD_PIECE_MIN,
  type UploadState,
  type UploadStatus,
} from '../../../../shared/phone-files';

/*
 * A file sent from this phone to Drashti (Session 54, D4: "Add from this Phone…"), as the page sends it: whole,
 * never shrunk, in pieces, each where Drashti says it has got to. A piece that fails (the Wi-Fi dropped, the phone
 * slept) is not lost: the page waits a moment, asks Drashti how much it has, and carries on from there, with
 * smaller pieces, for as long as the page is open. Pieces grow on a fast Wi-Fi and shrink on a slow one. Cancel
 * stops it at once, and Drashti removes what came. Once all of it is there, the page asks what became of it.
 */

/** An answer from Drashti: ok with what it says, or why not (status 0: Drashti could not be reached). */
export type Answer<T> =
  ({ ok: true } & T) | { ok: false; status: number; message: string; upload?: UploadStatus };

/** How the page talks to Drashti (upload-transport.ts; a stand-in in the tests). */
export interface Transport {
  begin(
    name: string,
    size: number,
  ): Promise<Answer<{ upload: UploadStatus; pieces: { first: number; max: number } }>>;
  /** A piece of the file at `offset`; `sent` hears how much of it has gone, as it goes. */
  piece(
    id: string,
    offset: number,
    bytes: Blob,
    sent: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<Answer<{ upload: UploadStatus }>>;
  status(id: string): Promise<Answer<{ upload: UploadStatus }>>;
  cancel(id: string): Promise<Answer<{ upload: UploadStatus }>>;
}

/** How a file this page sends stands, as its row shows it. */
export type SendingState = 'starting' | 'waiting' | UploadState;

export interface Sending {
  /** This page's own name for it (the same file may be sent twice). */
  key: string;
  name: string;
  size: number;
  /** Bytes Drashti has, and of the piece going now. */
  sent: number;
  state: SendingState;
  message: string | null;
  /** On air or recording: coming more slowly until the stream ends. */
  slowed: boolean;
}

export interface SendOptions {
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

const ENDED = new Set<SendingState>(['added', 'failed', 'cancelled']);

/** Waits between tries while Drashti cannot be reached, longest last (kept up while the page is open). */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000];

/** A piece taking less than this means a fast Wi-Fi (the next is twice as large); more than this, a slow one. */
const FAST_MS = 1000;
const SLOW_MS = 4000;

/** Not refused, only not answered: the Wi-Fi, or Drashti busy or starting again. */
const tryAgain = (status: number) => status === 0 || status === 429 || status === 503;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Send a file to Drashti; its row hears each change. Cancel stops it at once. */
export function sendFile(
  file: Blob & { name: string },
  transport: Transport,
  key: string,
  changed: (sending: Sending) => void,
  options: SendOptions = {},
): { cancel: () => void; done: Promise<Sending> } {
  const wait = options.wait ?? pause;
  const now = options.now ?? (() => performance.now());
  let view: Sending = {
    key,
    name: file.name,
    size: file.size,
    sent: 0,
    state: 'starting',
    message: null,
    slowed: false,
  };
  let id: string | null = null;
  let cancelled = false;
  /** Read afresh after each wait (Cancel may have come meanwhile). */
  const stopped = () => cancelled;
  let piece: AbortController | null = null;
  const show = (change: Partial<Sending>) => {
    if (ENDED.has(view.state)) return;
    view = { ...view, ...change };
    changed(view);
  };
  const from = (upload: UploadStatus) => {
    show({ sent: upload.received, state: upload.state, message: upload.message, slowed: upload.slowed });
  };

  const cancel = () => {
    if (cancelled || ENDED.has(view.state)) return;
    cancelled = true;
    piece?.abort();
    show({ state: 'cancelled', message: 'Cancelled.' });
    if (id) void transport.cancel(id);
  };

  /** Until Drashti answers what it has (a dropped connection waits here, trying again). */
  const askWhere = async (upload: string): Promise<Answer<{ upload: UploadStatus }>> => {
    for (let tries = 0; ; tries++) {
      show({ state: 'waiting', message: 'The connection dropped: picking up again…' });
      await wait(RETRY_MS[Math.min(tries, RETRY_MS.length - 1)] ?? 15_000);
      if (stopped()) return { ok: false, status: 0, message: 'Cancelled.' };
      const asked = await transport.status(upload);
      if (asked.ok || !tryAgain(asked.status)) return asked;
    }
  };

  const run = async (): Promise<Sending> => {
    if (file.size === 0) {
      show({ state: 'failed', message: 'This file is empty.' });
      return view;
    }
    // Begun: Drashti makes room for it (the size limit and the free space said in words when there is none).
    let begun: Awaited<ReturnType<Transport['begin']>>;
    for (let tries = 0; ; tries++) {
      begun = await transport.begin(file.name, file.size);
      if (begun.ok || !tryAgain(begun.status) || stopped()) break;
      show({ state: 'waiting', message: 'Drashti cannot be reached: trying again…' });
      await wait(RETRY_MS[Math.min(tries, RETRY_MS.length - 1)] ?? 15_000);
    }
    if (!begun.ok) {
      if (!stopped()) show({ state: 'failed', message: begun.message });
      return view;
    }
    id = begun.upload.id;
    if (stopped()) {
      void transport.cancel(id);
      return view;
    }
    from(begun.upload);
    const most = Math.max(UPLOAD_PIECE_MIN, Math.min(begun.pieces.max, UPLOAD_PIECE_MAX));
    let size = Math.max(UPLOAD_PIECE_MIN, Math.min(begun.pieces.first || UPLOAD_PIECE_FIRST, most));
    let received = begun.upload.received;
    while (received < file.size && view.state === 'receiving') {
      if (stopped()) return view;
      const end = Math.min(file.size, received + size);
      const started = now();
      piece = new AbortController();
      const at = received;
      const answer = await transport.piece(
        id,
        at,
        file.slice(at, end),
        (bytes) => {
          show({ sent: at + bytes });
        },
        piece.signal,
      );
      piece = null;
      if (stopped()) return view;
      if (answer.ok) {
        received = answer.upload.received;
        from(answer.upload);
        const took = now() - started;
        if (took < FAST_MS) size = Math.min(most, size * 2);
        else if (took > SLOW_MS) size = Math.max(UPLOAD_PIECE_MIN, Math.floor(size / 2));
        continue;
      }
      if (answer.status === 409 && answer.upload) {
        // From another place: carry on from where Drashti has it (or it has ended there).
        received = answer.upload.received;
        from(answer.upload);
        continue;
      }
      // A piece cut short on its way (Drashti says how much it has with it) is tried again, as a dropped one is.
      const cutShort = answer.status === 400 && answer.upload !== undefined;
      if (!tryAgain(answer.status) && !cutShort) {
        show({ state: 'failed', message: answer.message });
        return view;
      }
      // Dropped: smaller pieces from now on, from where Drashti has got to.
      size = Math.max(UPLOAD_PIECE_MIN, Math.floor(size / 2));
      const asked = await askWhere(id);
      if (stopped()) return view;
      if (!asked.ok) {
        show({ state: 'failed', message: asked.message });
        return view;
      }
      received = asked.upload.received;
      from(asked.upload);
    }
    // All of it is there: checked, then imported. What became of it is asked until it is known.
    while (!ENDED.has(view.state)) {
      await wait(1000);
      if (stopped()) return view;
      const asked = await transport.status(id);
      if (asked.ok) from(asked.upload);
      else if (!tryAgain(asked.status)) show({ state: 'failed', message: asked.message });
    }
    return view;
  };

  changed(view);
  return { cancel, done: run() };
}
