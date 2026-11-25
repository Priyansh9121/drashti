import {
  CHAT_DEVICE_KINDS,
  CHAT_NAME_RATE,
  CHAT_OPERATOR_ID,
  CHAT_OPERATOR_NAME,
  CHAT_PEOPLE_MAX,
  CHAT_RATE,
  CHAT_RATE_ALL,
  CHAT_READ_RATE,
  CHAT_REFUSAL,
  type ChatDeviceKind,
  type ChatEvent,
  type ChatMember,
  type ChatMessage,
  type ChatPhoneView,
  type ChatState,
  chatNameInputSchema,
  chatNameKey,
  chatNameSchema,
  chatReadSchema,
  chatSendSchema,
  chatTextSchema,
} from '../../shared/chat';
import type { DeviceKind } from '../../shared/network';
import { parsePlain } from '../../shared/plain-parse';
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

export interface ChatRefusal {
  ok: false;
  status: number;
  message: string;
}

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

/** The operator's name as names are compared (review S3): never a phone's, however it is written. */
const OPERATOR_KEY = chatNameKey(CHAT_OPERATOR_NAME);

export class ChatService {
  private readonly perPerson: RateLimiter;
  private readonly allPhones: RateLimiter;
  private readonly names: RateLimiter;
  private readonly reads: RateLimiter;

  constructor(private readonly deps: ChatServiceDeps) {
    const now = () => deps.now();
    this.perPerson = new RateLimiter(CHAT_RATE.perSecond, CHAT_RATE.burst, now);
    this.allPhones = new RateLimiter(CHAT_RATE_ALL.perSecond, CHAT_RATE_ALL.burst, now);
    this.names = new RateLimiter(CHAT_NAME_RATE.perSecond, CHAT_NAME_RATE.burst, now);
    this.reads = new RateLimiter(CHAT_READ_RATE.perSecond, CHAT_READ_RATE.burst, now);
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
    // The chat's phones cut off first (their feeds end 'revoked'), so none of them is told to read the new day.
    if (hadPhones) this.deps.devicesChanged();
    this.deps.toPhones({ kind: 'cleared', day: this.deps.store.state().day });
    this.deps.changed();
  }

  state(): ChatState {
    this.tick();
    return this.deps.store.state();
  }

  /** The day's chat for a phone: only the messages after `after` while Drashti still has that one (review M4). */
  private view(id: string, after?: string): ChatPhoneView {
    const state = this.deps.store.state();
    const at = after === undefined ? -1 : state.messages.findIndex((m) => m.id === after);
    return {
      ...state,
      messages: at < 0 ? state.messages : state.messages.slice(at + 1),
      you: { id, name: this.deps.store.person(id)?.name ?? null },
      since: at < 0 ? null : (after ?? null),
    };
  }

  /** A phone's read (opening, waking, reconnecting): a few at once, then one a second, refused before it is read. */
  read(device: ChatDeviceLike, raw: unknown = {}): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    if (!this.inChat(device)) return refuse(403, CHAT_REFUSAL.notIn);
    const input = chatReadSchema.safeParse(raw);
    if (!input.success) return refuse(400, CHAT_REFUSAL.badRead);
    if (!this.reads.take(device.id)) return refuse(429, CHAT_REFUSAL.readTooFast);
    this.tick();
    return { ok: true, chat: this.view(device.id, input.data.after) };
  }

  /** In the chat now: a person with a name, or a chat phone (review S2: whose comings and goings the operator hears). */
  isMember(id: string): boolean {
    return this.deps.store.person(id) !== null || this.deps.store.device(id) !== null;
  }

  setName(device: ChatDeviceLike, raw: unknown): { ok: true; chat: ChatPhoneView } | ChatRefusal {
    if (!this.inChat(device)) return refuse(403, CHAT_REFUSAL.notIn);
    this.tick();
    const input = chatNameInputSchema.safeParse(raw);
    const name = input.success ? chatNameSchema.safeParse(input.data.name) : null;
    if (!name?.success) return refuse(400, CHAT_REFUSAL.name);
    const key = chatNameKey(name.data);
    if (key === OPERATOR_KEY) return refuse(400, CHAT_REFUSAL.operatorName);
    const known = this.deps.store.person(device.id);
    if (known?.name === name.data) return { ok: true, chat: this.view(device.id) };
    if (this.deps.store.state().people.some((p) => p.id !== device.id && chatNameKey(p.name) === key))
      return refuse(409, CHAT_REFUSAL.nameTaken);
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
    // The schema's own words (CHAT_REFUSAL), never zod's (shared/plain-parse.ts).
    const text = parsePlain(chatTextSchema, input.data.text, CHAT_REFUSAL.empty);
    if (!text.success) return refuse(400, text.message);
    const from = this.deps.store.person(device.id);
    if (!from) return refuse(409, CHAT_REFUSAL.noName);
    // The person's own rate first: one looping phone spends only its own, never the group's (review M1).
    if (!this.perPerson.take(device.id) || !this.allPhones.take('all'))
      return refuse(429, CHAT_REFUSAL.tooFast);
    return { ok: true, message: this.post(from, text.data) };
  }

  /** The operator's message, from the window's Chat section: as "Operator", never held up by busy phones. */
  sendAsOperator(raw: unknown): { ok: true } | { ok: false; message: string } {
    this.tick();
    if (typeof raw !== 'string') return { ok: false, message: CHAT_REFUSAL.empty };
    const text = parsePlain(chatTextSchema, raw, CHAT_REFUSAL.empty);
    if (!text.success) return { ok: false, message: text.message };
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
    // A chat phone cut off first (its feed ends 'revoked'), then the others told of the people.
    if (wasPhone) this.deps.devicesChanged();
    if (wasPerson) this.deps.toPhones({ kind: 'people', people: this.deps.store.state().people });
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

  /** A chat phone of today (a new day unpairs them first: a request just after midnight is refused at once). */
  device(id: string): ChatDevice | null {
    this.tick();
    return this.deps.store.device(id);
  }

  devices(): ChatDevice[] {
    this.tick();
    return this.deps.store.devices();
  }

  /** The people as the operator's section lists them: each device's kind and whether it is connected now. */
  members(kindOf: (id: string) => DeviceKind | null, connected: ReadonlySet<string>): ChatMember[] {
    const members: ChatMember[] = [];
    for (const p of this.state().people) {
      if (p.id === CHAT_OPERATOR_ID) continue;
      const kind = this.deps.store.device(p.id) ? 'chat' : kindOf(p.id);
      if (!kind || !isChatKind(kind)) continue;
      members.push({ id: p.id, name: p.name, kind, connected: connected.has(p.id), named: true });
    }
    // Every chat phone with no name yet too (review M3): it reads the chat, so the operator sees it and can remove it.
    for (const d of this.deps.store.devices())
      if (!this.deps.store.person(d.id))
        members.push({ id: d.id, name: d.name, kind: 'chat', connected: connected.has(d.id), named: false });
    return members;
  }
}
