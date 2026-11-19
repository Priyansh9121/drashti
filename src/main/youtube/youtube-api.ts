import type { YouTubeBroadcast, YouTubeBroadcastState, YouTubePrivacy } from '../../shared/youtube';
import type { CallOptions, GoogleEndpoints } from './google-transport';

/*
 * The YouTube Data API calls Drashti makes (x31): not built yet. The red tests beside this name what they must do.
 */

export type ApiProblem =
  | 'offline'
  | 'guard'
  | 'unauthorized'
  | 'quota'
  | 'not-enabled'
  | 'too-fast'
  | 'too-many'
  | 'bad-time'
  | 'not-found'
  | 'no-channel'
  | 'transition'
  | 'odd-answer'
  | 'unavailable'
  | 'refused';

export type ApiAnswer<T> = { ok: true; value: T } | { ok: false; problem: ApiProblem; detail: string | null };

/** Not decided yet (the red tests say what they must be). */
export const AUTO_START = Boolean(process.env['X31_RED_NEVER_SET']);
export const AUTO_STOP = !AUTO_START;

interface RawBroadcast {
  id: string;
  snippet: { title: string; scheduledStartTime?: string };
  status?: { lifeCycleStatus?: string; privacyStatus?: string };
  contentDetails?: { boundStreamId?: string };
}
interface RawStream {
  id: string;
  cdn?: {
    ingestionInfo?: { streamName?: string; ingestionAddress?: string; rtmpsIngestionAddress?: string };
  };
}

const notYet = (): never => {
  throw new Error('The YouTube calls are not built yet.');
};
const notYetAsync = (): Promise<never> => Promise.reject(new Error('The YouTube calls are not built yet.'));

export const broadcastOf = (_raw: RawBroadcast): YouTubeBroadcast & { boundStreamId: string | null } =>
  notYet();
export const stateOf = (_value: string | undefined): YouTubeBroadcastState => notYet();
export const ingestOf = (
  _raw: RawStream,
  _onlyThisComputer: boolean,
): { key: string; address: string } | null => notYet();

export interface ScheduleWords {
  title: string;
  description: string;
  startsAt: number;
  privacy: YouTubePrivacy;
  madeForKids: boolean;
}

export class YouTubeApi {
  constructor(
    readonly endpoints: GoogleEndpoints,
    readonly call: CallOptions,
  ) {}

  channel(_token: string): Promise<ApiAnswer<string>> {
    return notYetAsync();
  }

  insertBroadcast(_token: string, _words: ScheduleWords): Promise<ApiAnswer<RawBroadcast>> {
    return notYetAsync();
  }

  insertStream(_token: string, _title: string): Promise<ApiAnswer<RawStream>> {
    return notYetAsync();
  }

  bind(_token: string, _broadcastId: string, _streamId: string): Promise<ApiAnswer<RawBroadcast>> {
    return notYetAsync();
  }

  upcoming(_token: string): Promise<ApiAnswer<RawBroadcast[]>> {
    return notYetAsync();
  }

  broadcast(_token: string, _id: string): Promise<ApiAnswer<RawBroadcast | null>> {
    return notYetAsync();
  }

  stream(_token: string, _id: string): Promise<ApiAnswer<RawStream | null>> {
    return notYetAsync();
  }

  complete(_token: string, _id: string): Promise<ApiAnswer<'ended' | 'already'>> {
    return notYetAsync();
  }
}
