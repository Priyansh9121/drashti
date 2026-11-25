import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_HISTORY_MAX, CHAT_OPERATOR_ID, CHAT_OPERATOR_NAME } from '../../shared/chat';
import { ChatStore } from './chat-store';

/*
 * The chat's day on the Drashti computer (alpha.23, QA23-CHAT-1): in memory and a small file in the data folder,
 * emptied at the day's change; damaged, it is emptied (never kept aside: it holds people's words); nothing of it in a
 * log line. Placeholder names and words only.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** 10:00 UTC on a placeholder day. */
const MORNING = Date.UTC(2026, 10, 25, 10, 0);

function setup(start = MORNING) {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-chat-store-'));
  dirs.push(dir);
  const file = join(dir, 'chat', 'today.json');
  const clock = { t: start };
  const logs: string[] = [];
  const pending: (() => void)[] = [];
  const make = () =>
    new ChatStore({
      file,
      now: () => clock.t,
      timeZone: 'UTC',
      later: (run) => {
        pending.push(run);
      },
      log: (_level, message) => {
        logs.push(message);
      },
    });
  const flushWrites = () => {
    for (const run of pending.splice(0)) run();
  };
  return { dir, file, clock, logs, make, flushWrites };
}

const person = (n: number) => ({ id: `device-${String(n)}`, name: `Person ${String(n)}` });

describe('the chat’s store', () => {
  it('starts empty, with the day and the operator among the people', () => {
    const { make } = setup();
    const store = make();
    store.load();
    expect(store.state()).toEqual({
      day: '2026-11-25',
      messages: [],
      people: [{ id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME }],
    });
  });

  it('keeps messages oldest first, each with an id and the time Drashti took it', () => {
    const { make, clock } = setup();
    const store = make();
    store.load();
    const a = store.add(person(1), 'Placeholder one');
    clock.t += 1000;
    const b = store.add(person(2), 'Placeholder two');
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ at: new Date(MORNING).toISOString(), from: person(1), text: 'Placeholder one' });
    expect(store.state().messages.map((m) => m.text)).toEqual(['Placeholder one', 'Placeholder two']);
  });

  it('keeps at most CHAT_HISTORY_MAX messages: the oldest go first', () => {
    const { make } = setup();
    const store = make();
    store.load();
    for (let i = 0; i < CHAT_HISTORY_MAX + 5; i++) store.add(person(1), `Placeholder ${String(i)}`);
    const texts = store.state().messages.map((m) => m.text);
    expect(texts).toHaveLength(CHAT_HISTORY_MAX);
    expect(texts[0]).toBe('Placeholder 5');
    expect(texts.at(-1)).toBe(`Placeholder ${String(CHAT_HISTORY_MAX + 4)}`);
  });

  it('keeps the people in the order they gave a name, a changed name in its place', () => {
    const { make } = setup();
    const store = make();
    store.load();
    store.setName('device-2', 'Person 2');
    store.setName('device-1', 'Person 1');
    store.setName('device-2', 'Person Two');
    expect(store.state().people).toEqual([
      { id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME },
      { id: 'device-2', name: 'Person Two' },
      { id: 'device-1', name: 'Person 1' },
    ]);
    expect(store.person('device-2')).toEqual({ id: 'device-2', name: 'Person Two' });
    expect(store.person('device-3')).toBeNull();
    expect(store.peopleCount()).toBe(2);
  });

  it('forgets a person (their messages stay as they were sent)', () => {
    const { make } = setup();
    const store = make();
    store.load();
    store.setName('device-1', 'Person 1');
    store.add(person(1), 'Placeholder');
    expect(store.forget('device-1')).toBe(true);
    expect(store.forget('device-1')).toBe(false);
    expect(store.person('device-1')).toBeNull();
    expect(store.state().messages[0]?.from).toEqual(person(1));
  });

  it('Clear chat empties the messages; the people and the chat’s phones stay', () => {
    const { make } = setup();
    const store = make();
    store.load();
    store.setName('device-1', 'Person 1');
    const phone = store.addDevice('a'.repeat(64));
    store.add(person(1), 'Placeholder');
    store.clearMessages();
    expect(store.state().messages).toEqual([]);
    expect(store.person('device-1')).not.toBeNull();
    expect(store.device(phone.id)).not.toBeNull();
  });

  it('pairs chat phones for the day: each named "Chat n", by its token’s hash only', () => {
    const { make } = setup();
    const store = make();
    store.load();
    const one = store.addDevice('a'.repeat(64));
    const two = store.addDevice('b'.repeat(64));
    expect(one.name).toBe('Chat 1');
    expect(two.name).toBe('Chat 2');
    expect(one.id).not.toBe(two.id);
    expect(store.devices().map((d) => d.tokenHash)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(store.removeDevice(one.id)).toBe(true);
    expect(store.removeDevice(one.id)).toBe(false);
    expect(store.addDevice('c'.repeat(64)).name).toBe('Chat 1');
  });

  it('is kept in its file, and read back by a new start the same day', () => {
    const { make, flushWrites, file } = setup();
    const store = make();
    store.load();
    store.setName('device-1', 'Person 1');
    const phone = store.addDevice('a'.repeat(64));
    store.add(person(1), 'Placeholder <b>one</b> 👍🏽');
    // Written after a moment, never on each message at once.
    expect(existsSync(file)).toBe(false);
    flushWrites();
    expect(existsSync(file)).toBe(true);
    const again = make();
    again.load();
    expect(again.state()).toEqual(store.state());
    expect(again.device(phone.id)).toEqual(store.device(phone.id));
    // The words are kept as typed, as JSON: never HTML-encoded.
    expect(readFileSync(file, 'utf8')).toContain('Placeholder <b>one</b> 👍🏽');
  });

  it('flush writes what is waiting at once (Drashti quitting)', () => {
    const { make, file } = setup();
    const store = make();
    store.load();
    store.add(person(1), 'Placeholder');
    store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ day: '2026-11-25' });
  });

  it('is emptied at the day’s change: messages, people and the chat’s phones, in memory and its file', () => {
    const { make, clock, flushWrites, file } = setup(Date.UTC(2026, 10, 25, 23, 59));
    const store = make();
    store.load();
    store.setName('device-1', 'Person 1');
    store.addDevice('a'.repeat(64));
    store.add(person(1), 'Placeholder');
    flushWrites();
    expect(store.newDay()).toBe(false);
    clock.t += 2 * 60 * 1000;
    expect(store.newDay()).toBe(true);
    expect(store.state()).toEqual({
      day: '2026-11-26',
      messages: [],
      people: [{ id: CHAT_OPERATOR_ID, name: CHAT_OPERATOR_NAME }],
    });
    expect(store.devices()).toEqual([]);
    expect(store.newDay()).toBe(false);
    flushWrites();
    expect(readFileSync(file, 'utf8')).not.toContain('Placeholder');
  });

  it('a file from an earlier day is emptied at the start, not read', () => {
    const { make, clock, flushWrites, file } = setup();
    const store = make();
    store.load();
    store.add(person(1), 'Placeholder from yesterday');
    store.addDevice('a'.repeat(64));
    flushWrites();
    clock.t += DAY_MS;
    const next = make();
    next.load();
    expect(next.state().messages).toEqual([]);
    expect(next.devices()).toEqual([]);
    expect(existsSync(file) && readFileSync(file, 'utf8').includes('Placeholder')).toBe(false);
  });

  it('a damaged file is emptied (never kept aside), and the log says so without a word of it', () => {
    const { make, file, logs } = setup();
    mkdirSync(join(file, '..'), { recursive: true });
    // Cut short: JSON.parse's own message would quote it.
    writeFileSync(file, '{"day":"2026-11-25","messages":[{"text":"Placeholder secret words');
    const store = make();
    store.load();
    expect(store.state().messages).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('Placeholder');
    expect(logs.join('\n')).not.toContain('secret');
    // Not in Drashti's form either.
    writeFileSync(file, JSON.stringify({ day: '2026-11-25', messages: [{ text: 'Placeholder secret' }] }));
    const other = make();
    other.load();
    expect(other.state().messages).toEqual([]);
    expect(logs.join('\n')).not.toContain('secret');
  });

  it('never writes a name or a word to the log, whatever happens', () => {
    const { make, flushWrites, logs, dir } = setup();
    const store = make();
    store.load();
    store.setName('device-1', 'Person Secretname');
    store.add({ id: 'device-1', name: 'Person Secretname' }, 'Placeholder secret words');
    // The folder taken by a file: the write fails.
    rmSync(join(dir, 'chat'), { recursive: true, force: true });
    writeFileSync(join(dir, 'chat'), 'not a folder');
    flushWrites();
    store.flush();
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain('Secretname');
      expect(line).not.toContain('secret words');
    }
  });
});
