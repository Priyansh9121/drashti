import type { ChatMessage, ChatPerson, ChatState } from '../../shared/chat';

export interface ChatDevice {
  id: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
}

export interface ChatStoreDeps {
  file: string;
  now(): number;
  timeZone?: string;
  later?(run: () => void): void;
  log(level: 'info' | 'warn', message: string): void;
}

export class ChatStore {
  constructor(private readonly deps: ChatStoreDeps) {}
  load(): void {}
  newDay(): boolean {
    return false;
  }
  state(): ChatState {
    return { day: '', messages: [], people: [] };
  }
  add(from: ChatPerson, text: string): ChatMessage {
    return { id: '', at: '', from, text };
  }
  setName(_id: string, _name: string): void {}
  person(_id: string): ChatPerson | null {
    return null;
  }
  peopleCount(): number {
    return 0;
  }
  forget(_id: string): boolean {
    return false;
  }
  clearMessages(): void {}
  addDevice(tokenHash: string): ChatDevice {
    return { id: '', name: '', tokenHash, pairedAt: '' };
  }
  device(_id: string): ChatDevice | null {
    return null;
  }
  devices(): ChatDevice[] {
    return [];
  }
  removeDevice(_id: string): boolean {
    return false;
  }
  flush(): void {}
}
