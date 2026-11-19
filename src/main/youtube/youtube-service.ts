import type { ClockStyle } from '../../shared/format';
import type { StreamProfiles, StreamProfilesResult, StreamStatus } from '../../shared/stream';
import type { YouTubeLink, YouTubeListResult, YouTubeResult, YouTubeStatus } from '../../shared/youtube';
import type { StreamKeyStore } from '../stream/key-store';
import type { BrowserListener, RandomBytes } from './google-sign-in';
import type { CallOptions, GoogleEndpoints } from './google-transport';

/*
 * Scheduling a YouTube stream from Drashti (x31), as the main process keeps it: not built yet. The red tests beside
 * this name what it must do.
 */

export const STATE_FIRST_MS = 15_000;
export const STATE_UNTIL_LIVE_MS = 20_000;
export const STATE_LIVE_MS = 60_000;

export interface YouTubeStreamSide {
  profilesView(): StreamProfiles;
  inUse(): boolean;
  saveProfile(id: unknown, input: unknown): StreamProfilesResult;
  setKey(id: unknown, key: unknown): StreamProfilesResult;
}

export interface YouTubeServiceDeps {
  secrets: StreamKeyStore;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  stream: YouTubeStreamSide;
  call: CallOptions;
  endpoints: GoogleEndpoints;
  openBrowser(url: string): Promise<void>;
  listen?(state: string): Promise<BrowserListener>;
  changed(status: YouTubeStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  clockStyle?(): ClockStyle;
  random?: RandomBytes;
  setTimer?(run: () => void, ms: number): () => void;
}

const notYet = (): never => {
  throw new Error('Scheduling on YouTube is not built yet.');
};

export class YouTubeService {
  constructor(readonly deps: YouTubeServiceDeps) {}

  status(): YouTubeStatus {
    return notYet();
  }

  links(): Record<string, YouTubeLink> {
    return notYet();
  }

  keyChangedByHand(_profileId: string): void {
    notYet();
  }

  setClient(_rawId: unknown, _rawSecret: unknown): YouTubeResult {
    return notYet();
  }

  removeClient(): YouTubeResult {
    return notYet();
  }

  signIn(): Promise<YouTubeResult> {
    return Promise.reject(new Error('Scheduling on YouTube is not built yet.'));
  }

  cancelSignIn(): YouTubeResult {
    return notYet();
  }

  signOut(): YouTubeResult {
    return notYet();
  }

  upcoming(): Promise<YouTubeListResult> {
    return Promise.reject(new Error('Scheduling on YouTube is not built yet.'));
  }

  schedule(_raw: unknown): Promise<YouTubeResult> {
    return Promise.reject(new Error('Scheduling on YouTube is not built yet.'));
  }

  useBroadcast(_rawProfileId: unknown, _rawBroadcastId: unknown): Promise<YouTubeResult> {
    return Promise.reject(new Error('Scheduling on YouTube is not built yet.'));
  }

  streamChanged(_status: StreamStatus): void {
    notYet();
  }

  streamEnded(_profileId: string): void {
    notYet();
  }

  endBroadcast(_rawProfileId: unknown): Promise<YouTubeResult> {
    return Promise.reject(new Error('Scheduling on YouTube is not built yet.'));
  }
}
