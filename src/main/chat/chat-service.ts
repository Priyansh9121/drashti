import {
  CHAT_DEVICE_KINDS,
  CHAT_NAME_RATE,
  CHAT_OPERATOR_ID,
  CHAT_OPERATOR_NAME,
  CHAT_PEOPLE_MAX,
  CHAT_RATE,
  CHAT_RATE_ALL,
  CHAT_REFUSAL,
  type ChatDeviceKind,
  type ChatEvent,
  type ChatMember,
  type ChatMessage,
  type ChatPhoneView,
  type ChatState,
  chatNameInputSchema,
  chatNameSchema,
  chatSendSchema,
  chatTextSchema,
} from '../../shared/chat';
import type { DeviceKind } from '../../shared/network';
import { RateLimiter } from '../network/limits';
import type { ChatDevice, ChatStore } from './chat-store';

/*
 * The chat's rules in Main (alpha.23, QA23-CHAT-1, shared/chat.ts), the same for every way in (a phone's request,
 * the operator window's): who is in it, the sizes and rates (refused in plain words here, whatever a page does), the
 * names, Clear chat, a person removed, and the day's change. What changed goes to the phones in the chat (the
 * network's feed) and to the operator window. The log hears only what happened, never a word of a message or a name.
 */

/** A paired device as the network knows it, enough to say whether it is in the chat. */
export interface ChatDeviceLike {
  id: string;
  kind: DeviceKind;
  poster: boolean;
}

export type ChatRefusal = { ok: false; status: number; message: string };

export interface ChatServiceDeps {
  store: ChatStore;
  now(): number;
  /** To every phone in the chat, at once (the network's feed). */
  toPhones(event: ChatEvent): void;
  /** The operator window: the chat changed. */
  changed(): void;
  /** The chat-only phones changed (one removed, a new day): the network's list of devices is sent again. */
  devicesChanged(): void;
  log(level: 'info' | 'warn', message: string): void;
}

const refuse = (status: number, message: string): ChatRefusal => ({ ok: false, status, message });

const isChatKind = (kind: DeviceKind): kind is ChatDeviceKind =>
  (CHAT_DEVICE_KINDS as readonly string[]).includes(kind);

/** The operator's name, as a phone might type it: never a phone's. */
const sameAsOperator = (name: string) =>
  name.toLocaleLowerCase('en') === CHAT_OPERATOR_NAME.toLocaleLowerCase('en');

export class ChatService {
  private readonly perPerson: RateLimiter;
  private readonly allPhones: RateLimiter;
  private readonly names: RateLimiter;

  constructor(private readonly deps: ChatServiceDeps) {
    const now = () => deps.now();
    this.perPerson = new RateLimiter(CHAT_RATE.perSecond, CHAT_RATE.burst, now);
    this.allPhones = new RateLimiter(CHAT_RATE_ALL.perSecond, CHAT_RATE_ALL.burst, now);
    this.names = new RateLimiter(CHAT_NAME_RATE.perSecond, CHAT_NAME_RATE.burst, now);
  }

  /** In the chat: an individually paired Remote or Announcements device, or a chat phone; never the poster link. */
  inChat(device: ChatDeviceLike): boolean {
    return !device.poster && isChatKind(device.kind);
  }

  /** Called now and then (and before every request): a new day empties the chat and unpairs its phones. */
  tick(): void {
    const hadPhones = this.deps.store.devices().length > 0;
    if (!this.deps.store.newDay()) return;
    this.deps.log('info', 'Chat: a new day began; the chat was emptied');
    this.deps.toPhones({ kind: 'cleared', day: this.deps.store.state().day });
    if (hadPhones) this.deps.devicesChanged();
    this.deps.changed();
  }

  state(): ChatState {
    this.tick();
    return this.deps.store.state();
  }

  private view(id: string): ChatPhoneView {
    const state = this.deps.store.state();
    return { ...state, you: { id, name: this.deps.store.person(id)?.name ?? null } };
  }

  read(device: ChatDeviceLike): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    if (!this.inChat(device)) return refuse(403, CHAT_REFUSAL.notIn);
    this.tick();
    return { ok: true, chat: this.view(device.id) };
  }

  setName(device: ChatDeviceLike, raw: unknown): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    if (!this.inChat(device)) return refuse(403, CHAT_REFUSAL.notIn);
    this.tick();
    const input = chatNameInputSchema.safeParse(raw);
    const name = input.success ? chatNameSchema.safeParse(input.data.name) : null;
    if (!name?.success) return refuse(400, CHAT_REFUSAL.name);
    if (sameAsOperator(name.data)) return refuse(400, CHAT_REFUSAL.operatorName);
    const known = this.deps.store.person(device.id);
    if (known?.name === name.data) return { ok: true, chat: this.view(device.id) };
    if (!known && this.deps.store.peopleCount() >= CHAT_PEOPLE_MAX) return refuse(409, CHAT_REFUSAL.full);
    if (!this.names.take(device.id)) return refuse(429, CHAT_REFUSAL.nameTooFast);
    this.deps.store.setName(device.id, name.data);
    this.deps.toPhones({ kind: 'people', people: this.deps.store.state().people });
    this.deps.changed();
    return { ok: true, chat: this.view(device.id) };
  }

  send(device: ChatDeviceLike, raw: unknown): { ok: true; message: ChatMessage } | ChatRefusal {
    if (!this.inChat(device)) return refuse(403, CHAT_REFUSAL.notIn);
    this.tick();
    const input = chatSendSchema.safeParse(raw);
    if (!input.success) return refuse(400, CHAT_REFUSAL.empty);
    const text = chatTextSchema.safeParse(input.data.text);
    if (!text.success) return refuse(400, text.error.issues[0]?.message ?? CHAT_REFUSAL.empty);
    const from = this.deps.store.person(device.id);
    if (!from) return refuse(409, CHAT_REFUSAL.noName);
    if (!this.allPhones.take('all') || !this.perPerson.take(device.id))
      return refuse(429, CHAT_REFUSAL.tooFast);
    return { ok: true, message: this.post(from, text.data) };
  }

  /** The operator's message, from the window's Chat section: as "Operator", never held up by busy phones. */
  sendAsOperator(raw: unknown): { ok: true } | { ok: false; message: string } {
    this.tick();
    if (typeof raw !== 'string') return { ok: false, message: CHAT_REFUSAL.empty };
    const text = chatTextSchema.safeParse(raw);
    if (!text.success) return { ok: false, message: text.error.issues[0]?.message ?? CHAT_REFUSAL.empty };
    if (!this.perPerson.take(CHAT_OPERATOR_ID)) return { ok: false, message: CHAT_REFUSAL.tooFast };
    this.post({ id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME }, text.data);
    return { ok: true };
  }

  private post(from: { id: string; name: string }, text: string): ChatMessage {
    const message = this.deps.store.add(from, text);
    this.deps.toPhones({ kind: 'message', message });
    this.deps.changed();
    return message;
  }

  /** The operator's Clear chat: the messages go, on every phone too; the people and their pairings stay. */
  clear(): void {
    this.tick();
    this.deps.store.clearMessages();
    this.deps.log('info', 'Chat: the operator cleared the chat');
    this.deps.toPhones({ kind: 'cleared', day: this.deps.store.state().day });
    this.deps.changed();
  }

  /**
   * A person out of the chat at once (removed by the operator, or their device removed): out of the people, and a
   * chat phone unpaired (the network cuts it off when it hears). Their messages stay as sent.
   */
  forget(id: string): boolean {
    if (id === CHAT_OPERATOR_ID) return false;
    const wasPerson = this.deps.store.forget(id);
    const wasPhone = this.deps.store.removeDevice(id);
    if (!wasPerson && !wasPhone) return false;
    this.deps.log('info', wasPhone ? 'Chat: a chat phone was removed' : 'Chat: a person left the chat');
    if (wasPerson) this.deps.toPhones({ kind: 'people', people: this.deps.store.state().people });
    if (wasPhone) this.deps.devicesChanged();
    this.deps.changed();
    return true;
  }

  /** A phone that scanned the Chat QR, paired for today by its token's hash; null when the day's phones are full. */
  addDevice(tokenHash: string): ChatDevice | null {
    this.tick();
    if (this.deps.store.devices().length >= CHAT_PEOPLE_MAX) return null;
    const device = this.deps.store.addDevice(tokenHash);
    this.deps.log('info', 'Chat: a phone joined the chat by the Chat QR');
    this.deps.changed();
    return device;
  }

  device(id: string): ChatDevice | null {
    return this.deps.store.device(id);
  }

  devices(): ChatDevice[] {
    return this.deps.store.devices();
  }

  /** The people as the operator's section lists them: each device's kind and whether it is connected now. */
  members(kindOf: (id: string) => DeviceKind | null, connected: ReadonlySet<string>): ChatMember[] {
    const members: ChatMember[] = [];
    for (const p of this.state().people) {
      if (p.id === CHAT_OPERATOR_ID) continue;
      const kind = this.deps.store.device(p.id) ? 'chat' : kindOf(p.id);
      if (!kind || !isChatKind(kind)) continue;
      members.push({ id: p.id, name: p.name, kind, connected: connected.has(p.id) });
    }
    return members;
  }
}
