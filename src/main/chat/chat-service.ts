import type { ChatEvent, ChatMember, ChatMessage, ChatPhoneView, ChatState } from '../../shared/chat';
import type { DeviceKind } from '../../shared/network';
import type { ChatDevice, ChatStore } from './chat-store';

export interface ChatDeviceLike {
  id: string;
  kind: DeviceKind;
  poster: boolean;
}

export type ChatRefusal = { ok: false; status: number; message: string };

export interface ChatServiceDeps {
  store: ChatStore;
  now(): number;
  toPhones(event: ChatEvent): void;
  changed(): void;
  devicesChanged(): void;
  log(level: 'info' | 'warn', message: string): void;
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}
  inChat(_d: ChatDeviceLike): boolean {
    return false;
  }
  read(_d: ChatDeviceLike): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    return { ok: false, status: 500, message: '' };
  }
  setName(_d: ChatDeviceLike, _raw: unknown): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    return { ok: false, status: 500, message: '' };
  }
  send(_d: ChatDeviceLike, _raw: unknown): { ok: true; message: ChatMessage } | ChatRefusal {
    return { ok: false, status: 500, message: '' };
  }
  sendAsOperator(_raw: unknown): { ok: true } | { ok: false; message: string } {
    return { ok: false, message: '' };
  }
  clear(): void {}
  forget(_id: string): boolean {
    return false;
  }
  addDevice(_tokenHash: string): ChatDevice | null {
    return null;
  }
  device(_id: string): ChatDevice | null {
    return null;
  }
  devices(): ChatDevice[] {
    return [];
  }
  members(_kindOf: (id: string) => DeviceKind | null, _connected: ReadonlySet<string>): ChatMember[] {
    return [];
  }
  state(): ChatState {
    return { day: '', messages: [], people: [] };
  }
  tick(): void {}
}
