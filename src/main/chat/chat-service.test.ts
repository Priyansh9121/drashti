import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_OPERATOR_ID,
  CHAT_OPERATOR_NAME,
  CHAT_PEOPLE_MAX,
  CHAT_RATE,
  CHAT_REFUSAL,
  CHAT_TEXT_MAX,
  type ChatEvent,
} from '../../shared/chat';
import type { DeviceKind } from '../../shared/network';
import { ChatService, type ChatDeviceLike } from './chat-service';
import { ChatStore } from './chat-store';

/*
 * The chat's rules in Main (alpha.23, QA23-CHAT-1): who is in it, the limits (sizes and rates, refused in plain
 * words here, not only on the page), names, Clear chat, a person removed, the day's change, and what the phones and
 * the operator window hear. Nothing of a message or a name in any log line. Placeholder names and words only.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MORNING = Date.UTC(2026, 10, 25, 10, 0);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-chat-service-'));
  dirs.push(dir);
  const clock = { t: MORNING };
  const logs: string[] = [];
  const events: ChatEvent[] = [];
  let changes = 0;
  let devicesChanged = 0;
  const log = (_level: 'info' | 'warn', message: string) => {
    logs.push(message);
  };
  const store = new ChatStore({
    file: join(dir, 'chat', 'today.json'),
    now: () => clock.t,
    timeZone: 'UTC',
    later: () => undefined,
    log,
  });
  store.load();
  const chat = new ChatService({
    store,
    now: () => clock.t,
    toPhones: (event) => {
      events.push(event);
    },
    changed: () => {
      changes++;
    },
    devicesChanged: () => {
      devicesChanged++;
    },
    log,
  });
  return {
    chat,
    store,
    clock,
    logs,
    events,
    changes: () => changes,
    devicesChanged: () => devicesChanged,
  };
}

const device = (n: number, kind: DeviceKind = 'remote', poster = false): ChatDeviceLike => ({
  id: `device-${String(n)}`,
  kind,
  poster,
});

/** A device in the chat with its name given. */
function named(chat: ChatService, n: number, kind: DeviceKind = 'remote'): ChatDeviceLike {
  const d = device(n, kind);
  expect(chat.setName(d, { name: `Person ${String(n)}` }).ok).toBe(true);
  return d;
}

describe('who is in the chat', () => {
  it('every individually paired Remote and Announcements device and chat phone; never the poster link or a Stage device', () => {
    const { chat } = setup();
    expect(chat.inChat(device(1, 'remote'))).toBe(true);
    expect(chat.inChat(device(2, 'announcements'))).toBe(true);
    expect(chat.inChat(device(3, 'chat'))).toBe(true);
    expect(chat.inChat(device(4, 'stage'))).toBe(false);
    expect(chat.inChat(device(5, 'announcements', true))).toBe(false);
    for (const d of [device(4, 'stage'), device(5, 'announcements', true)]) {
      expect(chat.read(d)).toEqual({ ok: false, status: 403, message: CHAT_REFUSAL.notIn });
      expect(chat.setName(d, { name: 'Person' })).toEqual({
        ok: false,
        status: 403,
        message: CHAT_REFUSAL.notIn,
      });
      expect(chat.send(d, { text: 'Placeholder' })).toEqual({
        ok: false,
        status: 403,
        message: CHAT_REFUSAL.notIn,
      });
    }
  });

  it('a phone reads the day’s chat and who it is (no name yet, then its name)', () => {
    const { chat } = setup();
    const d = device(1);
    expect(chat.read(d)).toEqual({
      ok: true,
      chat: {
        day: '2026-11-25',
        messages: [],
        people: [{ id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME }],
        you: { id: 'device-1', name: null },
      },
    });
    named(chat, 1);
    const read = chat.read(d);
    expect(read.ok && read.chat.you).toEqual({ id: 'device-1', name: 'Person 1' });
  });
});

describe('names', () => {
  it('are cleaned as Rename… cleans a name and kept; the phones hear of the people', () => {
    const { chat, events, changes } = setup();
    const answer = chat.setName(device(1), { name: '  Person\nOne ' });
    expect(answer.ok && answer.chat.you).toEqual({ id: 'device-1', name: 'Person One' });
    expect(events).toEqual([
      {
        kind: 'people',
        people: [
          { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME },
          { id: 'device-1', name: 'Person One' },
        ],
      },
    ]);
    expect(changes()).toBe(1);
    // The same name again changes nothing and tells no one.
    chat.setName(device(1), { name: 'Person One' });
    expect(events).toHaveLength(1);
  });

  it('refuses an empty or long name, the operator’s, and anything but { name }', () => {
    const { chat } = setup();
    for (const name of ['', ' \u200B ', 'x'.repeat(61)])
      expect(chat.setName(device(1), { name })).toEqual({
        ok: false,
        status: 400,
        message: CHAT_REFUSAL.name,
      });
    for (const name of ['Operator', ' operator ', 'OPERATOR'])
      expect(chat.setName(device(1), { name })).toEqual({
        ok: false,
        status: 400,
        message: CHAT_REFUSAL.operatorName,
      });
    for (const bad of [null, 'Person', { name: 5 }, { name: 'Person', extra: true }])
      expect(chat.setName(device(1), bad)).toEqual({ ok: false, status: 400, message: CHAT_REFUSAL.name });
  });

  it('a few changes at once, then refused in plain words for a while', () => {
    const { chat, clock } = setup();
    const answers = Array.from({ length: 5 }, (_, i) =>
      chat.setName(device(1), { name: `Person ${String(i)}` }),
    );
    expect(answers.filter((a) => a.ok)).toHaveLength(3);
    expect(answers.at(-1)).toEqual({ ok: false, status: 429, message: CHAT_REFUSAL.nameTooFast });
    clock.t += 10_000;
    expect(chat.setName(device(1), { name: 'Person later' }).ok).toBe(true);
  });

  it('at most CHAT_PEOPLE_MAX people a day; one already in may change their name', () => {
    const { chat } = setup();
    for (let i = 0; i < CHAT_PEOPLE_MAX; i++) named(chat, i);
    expect(chat.setName(device(999), { name: 'Person late' })).toEqual({
      ok: false,
      status: 409,
      message: CHAT_REFUSAL.full,
    });
    expect(chat.setName(device(0), { name: 'Person zero' }).ok).toBe(true);
  });
});

describe('messages', () => {
  it('need a name first', () => {
    const { chat } = setup();
    expect(chat.send(device(1), { text: 'Placeholder' })).toEqual({
      ok: false,
      status: 409,
      message: CHAT_REFUSAL.noName,
    });
  });

  it('go to every phone and the operator window, with the sender’s name, as plain text', () => {
    const { chat, events, changes } = setup();
    const d = named(chat, 1);
    events.length = 0;
    const before = changes();
    const typed = '<img src=x onerror=alert(1)> Placeholder 👍🏽';
    const sent = chat.send(d, { text: typed });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.message).toMatchObject({ from: { id: 'device-1', name: 'Person 1' }, text: typed });
    expect(events).toEqual([{ kind: 'message', message: sent.message }]);
    expect(changes()).toBe(before + 1);
    expect(chat.state().messages).toEqual([sent.message]);
  });

  it('refuse empty, long and malformed ones in plain words, before anything is kept', () => {
    const { chat, events } = setup();
    const d = named(chat, 1);
    events.length = 0;
    expect(chat.send(d, { text: '  ' })).toEqual({ ok: false, status: 400, message: CHAT_REFUSAL.empty });
    expect(chat.send(d, { text: 'a'.repeat(CHAT_TEXT_MAX + 1) })).toEqual({
      ok: false,
      status: 400,
      message: CHAT_REFUSAL.tooLong,
    });
    for (const bad of [null, 'Placeholder', { text: 5 }, { text: 'Placeholder', from: 'Operator' }])
      expect(chat.send(d, bad)).toEqual({ ok: false, status: 400, message: CHAT_REFUSAL.empty });
    expect(events).toEqual([]);
    expect(chat.state().messages).toEqual([]);
  });

  it('one person: a few at once, then refused until the rate allows', () => {
    const { chat, clock } = setup();
    const d = named(chat, 1);
    const answers = Array.from({ length: CHAT_RATE.burst + 1 }, () => chat.send(d, { text: 'Placeholder' }));
    expect(answers.filter((a) => a.ok)).toHaveLength(CHAT_RATE.burst);
    expect(answers.at(-1)).toEqual({ ok: false, status: 429, message: CHAT_REFUSAL.tooFast });
    clock.t += 2000;
    expect(chat.send(d, { text: 'Placeholder' }).ok).toBe(true);
    // Another person is not held up by the first.
    expect(chat.send(named(chat, 2), { text: 'Placeholder' }).ok).toBe(true);
  });

  it('everyone together: at most the group’s rate, so a busy chat never slows the show', () => {
    const { chat } = setup();
    const people = Array.from({ length: 10 }, (_, i) => named(chat, i));
    let ok = 0;
    let refused = 0;
    for (const d of people)
      for (let i = 0; i < 3; i++) {
        const a = chat.send(d, { text: 'Placeholder' });
        if (a.ok) ok++;
        else if (a.status === 429 && a.message === CHAT_REFUSAL.tooFast) refused++;
      }
    expect(ok).toBe(20);
    expect(refused).toBe(10);
  });

  it('the operator writes as "Operator", refused in the same plain words, and not held up by busy phones', () => {
    const { chat, events } = setup();
    const people = Array.from({ length: 10 }, (_, i) => named(chat, i));
    for (const d of people) for (let i = 0; i < 3; i++) chat.send(d, { text: 'Placeholder' });
    events.length = 0;
    const sent = chat.sendAsOperator('Placeholder from the operator');
    expect(sent).toEqual({ ok: true });
    expect(events).toMatchObject([
      { kind: 'message', message: { from: { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME } } },
    ]);
    expect(chat.sendAsOperator(' ')).toEqual({ ok: false, message: CHAT_REFUSAL.empty });
    expect(chat.sendAsOperator(42)).toEqual({ ok: false, message: CHAT_REFUSAL.empty });
  });
});

describe('the operator’s Clear chat and Remove', () => {
  it('Clear chat empties the messages on every phone; the people stay', () => {
    const { chat, events } = setup();
    const d = named(chat, 1);
    chat.send(d, { text: 'Placeholder' });
    events.length = 0;
    chat.clear();
    expect(chat.state().messages).toEqual([]);
    expect(events).toEqual([{ kind: 'cleared', day: '2026-11-25' }]);
    expect(chat.read(d).ok && chat.read(d)).toMatchObject({ chat: { you: { name: 'Person 1' } } });
  });

  it('a removed person is out of the people at once; their messages stay', () => {
    const { chat, events } = setup();
    const d = named(chat, 1);
    named(chat, 2);
    chat.send(d, { text: 'Placeholder' });
    events.length = 0;
    expect(chat.forget('device-1')).toBe(true);
    expect(events).toEqual([
      {
        kind: 'people',
        people: [
          { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME },
          { id: 'device-2', name: 'Person 2' },
        ],
      },
    ]);
    expect(chat.state().messages).toHaveLength(1);
    expect(chat.forget('device-1')).toBe(false);
    expect(chat.forget(CHAT_OPERATOR_ID)).toBe(false);
  });

  it('a chat phone removed is unpaired: gone from the chat’s phones, and the network is told', () => {
    const { chat, devicesChanged } = setup();
    const phone = chat.addDevice('a'.repeat(64));
    expect(phone).not.toBeNull();
    if (!phone) return;
    const before = devicesChanged();
    chat.setName({ id: phone.id, kind: 'chat', poster: false }, { name: 'Person 1' });
    expect(chat.forget(phone.id)).toBe(true);
    expect(chat.device(phone.id)).toBeNull();
    expect(devicesChanged()).toBe(before + 1);
  });

  it('at most CHAT_PEOPLE_MAX chat phones a day', () => {
    const { chat } = setup();
    for (let i = 0; i < CHAT_PEOPLE_MAX; i++)
      expect(chat.addDevice(i.toString(16).padStart(64, '0'))).not.toBeNull();
    expect(chat.addDevice('f'.repeat(64))).toBeNull();
  });
});

describe('the day’s change', () => {
  it('empties the chat and unpairs the chat’s phones; the phones and the network hear of it', () => {
    const { chat, clock, events, devicesChanged } = setup();
    const d = named(chat, 1);
    chat.addDevice('a'.repeat(64));
    chat.send(d, { text: 'Placeholder' });
    events.length = 0;
    const before = devicesChanged();
    clock.t = Date.UTC(2026, 10, 26, 0, 1);
    chat.tick();
    expect(events).toEqual([{ kind: 'cleared', day: '2026-11-26' }]);
    expect(devicesChanged()).toBe(before + 1);
    expect(chat.devices()).toEqual([]);
    expect(chat.state()).toMatchObject({ day: '2026-11-26', messages: [] });
    // A phone's next request sees the new day too (no tick needed).
    clock.t = Date.UTC(2026, 10, 27, 0, 1);
    expect(chat.read(d)).toMatchObject({ ok: true, chat: { day: '2026-11-27', you: { name: null } } });
  });
});

describe('the operator’s Chat section', () => {
  it('lists the people with their device’s kind and whether it is connected, never the operator', () => {
    const { chat } = setup();
    named(chat, 1, 'remote');
    const phone = chat.addDevice('a'.repeat(64));
    if (!phone) throw new Error('no phone');
    chat.setName({ id: phone.id, kind: 'chat', poster: false }, { name: 'Person 2' });
    const members = chat.members((id) => (id === 'device-1' ? 'remote' : null), new Set([phone.id]));
    expect(members).toEqual([
      { id: 'device-1', name: 'Person 1', kind: 'remote', connected: false, named: true },
      { id: phone.id, name: 'Person 2', kind: 'chat', connected: true, named: true },
    ]);
  });
});

describe('the log', () => {
  it('never has a word of a message or a name, whatever happens', () => {
    const { chat, clock, logs } = setup();
    const d = device(1);
    chat.setName(d, { name: 'Person Secretname' });
    chat.send(d, { text: 'Placeholder secret words' });
    chat.sendAsOperator('Operator secret words');
    chat.send(d, { text: 'x'.repeat(CHAT_TEXT_MAX + 1) });
    chat.setName(device(2, 'stage'), { name: 'Person Othersecret' });
    chat.clear();
    chat.forget('device-1');
    const phone = chat.addDevice('a'.repeat(64));
    if (phone) chat.forget(phone.id);
    clock.t += 24 * 60 * 60 * 1000;
    chat.tick();
    for (const line of logs) {
      expect(line).not.toMatch(/secret/iu);
      expect(line).not.toContain('Person');
    }
  });
});

describe('round 1 of the review (a22-review-chat)', () => {
  it('M1: one phone looping on Send never silences the others (its own rate is asked first)', () => {
    const { chat } = setup();
    const loud = named(chat, 1);
    const quiet = named(chat, 2);
    for (let i = 0; i < 50; i++) chat.send(loud, { text: 'Placeholder' });
    expect(chat.send(quiet, { text: 'Placeholder' }).ok).toBe(true);
  });

  it('M3: lists every chat phone, named or not, so the operator can see and remove it', () => {
    const { chat } = setup();
    const quiet = chat.addDevice('a'.repeat(64));
    const talker = chat.addDevice('b'.repeat(64));
    if (!quiet || !talker) throw new Error('no phones');
    chat.setName({ id: talker.id, kind: 'chat', poster: false }, { name: 'Person 2' });
    expect(chat.members(() => null, new Set([quiet.id]))).toEqual([
      { id: talker.id, name: 'Person 2', kind: 'chat', connected: false, named: true },
      { id: quiet.id, name: 'Chat 1', kind: 'chat', connected: true, named: false },
    ]);
  });

  it('M4: a phone reads the chat at most a few times at once, refused before anything is read', () => {
    const { chat, store, clock } = setup();
    const d = device(1);
    const reads = vi.spyOn(store, 'state');
    const answers = Array.from({ length: 6 }, () => chat.read(d));
    expect(answers.filter((a) => a.ok)).toHaveLength(5);
    const calls = reads.mock.calls.length;
    expect(chat.read(d)).toEqual({ ok: false, status: 429, message: CHAT_REFUSAL.readTooFast });
    expect(reads.mock.calls.length).toBe(calls);
    clock.t += 1000;
    expect(chat.read(d).ok).toBe(true);
    // Another phone is not held up by the first.
    expect(chat.read(device(2)).ok).toBe(true);
  });

  it('M4: a phone reads only what is new since the last message it has; else the whole day', () => {
    const { chat } = setup();
    const d = named(chat, 1);
    const first = chat.send(d, { text: 'Placeholder one' });
    const second = chat.send(d, { text: 'Placeholder two' });
    if (!first.ok || !second.ok) throw new Error('not sent');
    const after = chat.read(d, { after: first.message.id });
    expect(after.ok && after.chat.messages.map((m) => m.text)).toEqual(['Placeholder two']);
    expect(after.ok && after.chat.since).toBe(first.message.id);
    const none = chat.read(d, { after: second.message.id });
    expect(none.ok && none.chat.messages).toEqual([]);
    // An id it no longer knows (Clear chat, a new day, too old): the whole day, since null.
    const whole = chat.read(d, { after: 'unknown-id' });
    expect(whole.ok && whole.chat.messages).toHaveLength(2);
    expect(whole.ok && whole.chat.since).toBeNull();
    expect(chat.read(d, {}).ok && chat.read(d, {})).toMatchObject({ chat: { since: null } });
    for (const bad of [{ after: 5 }, { after: 'x'.repeat(200) }, { other: 1 }, 'text'])
      expect(chat.read(d, bad)).toMatchObject({ ok: false, status: 400 });
  });

  it('S3: no name that reads as the operator’s, or as another person’s today', () => {
    const { chat } = setup();
    named(chat, 1);
    for (const name of [
      'Operator.',
      '0perator',
      '\uFF2F\uFF50\uFF45\uFF52\uFF41\uFF54\uFF4F\uFF52',
      'Operator ✅',
      'O p e r a t o r',
    ])
      expect(chat.setName(device(2), { name }), name).toEqual({
        ok: false,
        status: 400,
        message: CHAT_REFUSAL.operatorName,
      });
    for (const name of ['Person 1', 'person  1', 'Person 1!', 'PERSON l'])
      expect(chat.setName(device(2), { name }), name).toEqual({
        ok: false,
        status: 409,
        message: CHAT_REFUSAL.nameTaken,
      });
    // One's own name again is no clash; names that differ only by a vowel sign are different names.
    expect(chat.setName(device(1), { name: 'Person 1' }).ok).toBe(true);
    expect(chat.setName(device(3), { name: 'રામ' }).ok).toBe(true);
    expect(chat.setName(device(4), { name: 'રમ' }).ok).toBe(true);
  });
});
