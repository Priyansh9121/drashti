import { describe, expect, it } from 'vitest';
import type { AnnouncementsView } from '../../shared/announcements';
import { AnnouncementRepo } from '../db/announcements';
import { openDatabase } from '../db/database';
import { DeviceRepo } from '../db/devices';
import { MessageRepo } from '../db/messages';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport } from '../engine/testing';
import { AnnouncementService } from './announcement-service';

/* Announcements from phones, with the real library and show engine: placeholder words and names, made-up addresses. */

const PHONE = '192.168.1.20';
const MINUTE = 60_000;

function setup() {
  const db = openDatabase(':memory:');
  const devices = new DeviceRepo(db);
  const phone = devices.add({ name: 'Placeholder phone', kind: 'announcements', tokenHash: 'a'.repeat(64) });
  const poster = devices.add({
    name: 'Announcements poster',
    kind: 'announcements',
    tokenHash: 'b'.repeat(64),
    poster: true,
  });
  const repo = new AnnouncementRepo(db);
  const messages = new MessageRepo(db);
  let clock = 1_000_000;
  const engine = new ShowEngine(makeSource(), new RecordingTransport(), () => clock);
  const timers: { at: number; run: () => void }[] = [];
  const views: AnnouncementsView[] = [];
  let templatesChanged = 0;
  const make = () =>
    new AnnouncementService({
      repo,
      engine: {
        state: () => engine.current,
        dispatch: (c) => engine.dispatch(c),
        showTicker: (item) => engine.showTicker(item),
        takeDown: (id) => engine.takeDown(id),
      },
      templates: {
        list: () => messages.list(),
        create: (t) => messages.create(t),
        changed: () => {
          templatesChanged++;
        },
      },
      now: () => clock,
      minuteMs: MINUTE,
      schedule: (ms, run) => {
        const t = { at: clock + ms, run };
        timers.push(t);
        return () => {
          timers.splice(timers.indexOf(t), 1);
        };
      },
      changed: (v) => views.push(v),
      log: () => undefined,
    });
  const service = make();
  /** Time passes; whatever was waiting for it runs. */
  const later = (ms: number) => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at))
      if (t.at <= clock) {
        timers.splice(timers.indexOf(t), 1);
        t.run();
      }
  };
  const send = (text: string, options: { device?: typeof phone; address?: string; minutes?: number } = {}) =>
    service.submit(options.device ?? phone, options.address ?? PHONE, {
      text,
      from: 'Placeholder name',
      minutes: options.minutes ?? 10,
    });
  const idOf = (answer: { body: unknown }) =>
    (answer.body as { announcement: { id: string } }).announcement.id;
  return {
    db,
    devices,
    phone,
    poster,
    repo,
    messages,
    engine,
    service,
    make,
    views,
    later,
    send,
    idOf,
    templatesChanged: () => templatesChanged,
  };
}

describe('announcements from phones', () => {
  it('a phone sends one: it waits for the operator, and nothing goes on the screens', () => {
    const { send, service, engine, views } = setup();
    const answer = send('Placeholder: prasad in the hall after arti');
    expect(answer.status).toBe(202);
    expect(answer.body).toMatchObject({ ok: true, announcement: { status: 'waiting', until: null } });
    expect(service.view().waiting).toMatchObject([
      {
        text: 'Placeholder: prasad in the hall after arti',
        from: 'Placeholder name',
        minutes: 10,
        deviceName: 'Placeholder phone',
        status: 'waiting',
      },
    ]);
    expect(views).toHaveLength(1);
    expect(engine.current.layers.messages).toEqual([]);
    expect(engine.current.layers.ticker).toBeNull();
  });

  it('refuses empty or long words, a time out of range, and anything else in the request', () => {
    const { service, phone } = setup();
    const bad = [
      { text: '   ', from: 'A', minutes: 10 },
      { text: 'x'.repeat(201), from: 'A', minutes: 10 },
      { text: 'Placeholder', from: '', minutes: 10 },
      { text: 'Placeholder', from: 'x'.repeat(61), minutes: 10 },
      { text: 'Placeholder', from: 'A', minutes: 0 },
      { text: 'Placeholder', from: 'A', minutes: 121 },
      { text: 'Placeholder', from: 'A', minutes: 1.5 },
      { text: 'Placeholder', from: 'A', minutes: 10, shownAs: 'ticker' },
      null,
    ];
    for (const input of bad)
      expect(service.submit(phone, PHONE, input).status, JSON.stringify(input)).toBe(400);
    expect(service.view().waiting).toEqual([]);
  });

  it('keeps the words on one line, with their spaces tidied', () => {
    const { send, service } = setup();
    send('  Placeholder\n\nwords   here  ');
    expect(service.view().waiting[0]?.text).toBe('Placeholder words here');
  });

  it('lets one phone have 3 waiting, a poster as many as its phones, and the queue 30', () => {
    const { send, service, poster, idOf } = setup();
    const first = send('Placeholder 1');
    send('Placeholder 2');
    send('Placeholder 3');
    expect(send('Placeholder 4').status).toBe(429);
    // Once the operator has decided on one, there is room again.
    expect(service.reject({ id: idOf(first) }).ok).toBe(true);
    expect(send('Placeholder 4').status).toBe(202);
    // The poster's link, from many phones (addresses): 3 each.
    for (let i = 0; i < 9; i++)
      expect(send(`Poster ${i}`, { device: poster, address: `192.168.1.${100 + (i % 3)}` }).status).toBe(202);
    expect(send('Poster 9', { device: poster, address: '192.168.1.100' }).status).toBe(429);
    for (let i = 0; i < 18; i++)
      expect(send(`More ${i}`, { device: poster, address: `192.168.2.${i}` }).status).toBe(202);
    expect(service.view().waiting).toHaveLength(30);
    expect(send('One too many', { device: poster, address: '192.168.3.1' })).toMatchObject({ status: 429 });
  });

  it('tells a phone what became of its own announcements, never anyone else’s', () => {
    const { send, service, phone, poster, idOf } = setup();
    const id = idOf(send('Placeholder'));
    expect(service.statusFor(phone, { id })).toMatchObject({
      status: 200,
      body: { announcement: { id, status: 'waiting' } },
    });
    expect(service.statusFor(poster, { id }).status).toBe(404);
    expect(service.statusFor(phone, { id: 'not an id!' }).status).toBe(404);
  });

  it('edits one that is waiting: new words and time; the words as sent are kept', () => {
    const { send, service, idOf } = setup();
    const id = idOf(send('Placeholder with a tpyo'));
    const r = service.edit({ id, text: 'Placeholder with no typo', minutes: 5 });
    expect(r.ok).toBe(true);
    expect(service.view().waiting[0]).toMatchObject({
      text: 'Placeholder with no typo',
      sentText: 'Placeholder with a tpyo',
      minutes: 5,
    });
    service.approve({ id, as: 'ticker' });
    expect(service.edit({ id, text: 'Too late', minutes: 5 })).toMatchObject({ ok: false });
  });

  it('approves one as a message from Drashti’s own template, made the first time; it comes off by itself', () => {
    const { send, service, engine, messages, later, idOf, templatesChanged } = setup();
    const id = idOf(send('Placeholder: car 12 please move', { minutes: 2 }));
    const r = service.approve({ id, as: 'message' });
    expect(r.ok).toBe(true);
    expect(messages.list().map((t) => [t.name, t.template])).toEqual([['Announcement', '{announcement}']]);
    expect(templatesChanged()).toBe(1);
    expect(engine.current.layers.messages).toMatchObject([{ id, text: 'Placeholder: car 12 please move' }]);
    expect(service.view().showing).toMatchObject([{ id, status: 'showing', shownAs: 'message' }]);
    later(MINUTE);
    expect(engine.current.layers.messages).toHaveLength(1);
    later(MINUTE);
    expect(engine.current.layers.messages).toEqual([]);
    expect(service.view()).toMatchObject({ showing: [], earlier: [{ id, status: 'ended' }] });
    // The second time, the same template.
    const next = idOf(send('Placeholder again'));
    service.approve({ id: next, as: 'message' });
    expect(messages.list()).toHaveLength(1);
  });

  it('approves one as a message from a chosen template, with who it is from; refuses one asking for more', () => {
    const { send, service, engine, messages, idOf } = setup();
    const fromTemplate = messages.create({
      name: 'From someone',
      template: '{from} asks: {words}',
      fields: {},
    });
    const plate = messages.create({ name: 'Car', template: 'Car {plate} ({colour})', fields: {} });
    const id = idOf(send('Placeholder words'));
    expect(service.approve({ id, as: 'message', templateId: plate })).toMatchObject({ ok: false });
    expect(service.approve({ id, as: 'message', templateId: 'gone' })).toMatchObject({ ok: false });
    expect(service.approve({ id, as: 'message', templateId: fromTemplate }).ok).toBe(true);
    expect(engine.current.layers.messages[0]?.text).toBe('Placeholder name asks: Placeholder words');
    expect(service.approve({ id, as: 'ticker' })).toMatchObject({ ok: false });
  });

  it('approves one in the ticker, rejects another, and takes one off before its time', () => {
    const { send, service, engine, idOf, later } = setup();
    const one = idOf(send('Placeholder ticker one'));
    const two = idOf(send('Placeholder ticker two'));
    const three = idOf(send('Placeholder rejected'));
    service.approve({ id: one, as: 'ticker' });
    service.approve({ id: two, as: 'ticker' });
    expect(engine.current.layers.ticker?.items.map((i) => i.text)).toEqual([
      'Placeholder ticker one',
      'Placeholder ticker two',
    ]);
    expect(service.reject({ id: three }).ok).toBe(true);
    expect(service.reject({ id: three })).toMatchObject({ ok: false });
    later(1000);
    expect(service.takeOff({ id: one }).ok).toBe(true);
    expect(engine.current.layers.ticker?.items.map((i) => i.id)).toEqual([two]);
    expect(service.takeOff({ id: one })).toMatchObject({ ok: false });
    expect(service.view().earlier.map((a) => [a.id, a.status])).toEqual([
      [one, 'ended'],
      [three, 'rejected'],
    ]);
  });

  it('after a restart, what recovery put back carries on; the rest that was showing has ended', () => {
    const { send, service, engine, make, later, idOf, repo } = setup();
    const kept = idOf(send('Placeholder kept', { minutes: 10 }));
    const cleared = idOf(send('Placeholder cleared', { minutes: 10 }));
    const over = idOf(send('Placeholder over', { minutes: 1 }));
    for (const id of [kept, cleared, over]) service.approve({ id, as: 'ticker' });
    service.close();
    // Drashti stops; recovery puts back the ticker without "cleared" (Clear all took it), after 2 minutes.
    engine.takeDown(cleared);
    later(2 * MINUTE);
    const again = make();
    again.resume();
    expect(repo.get(kept)?.status).toBe('showing');
    expect(repo.get(cleared)?.status).toBe('ended');
    expect(repo.get(over)?.status).toBe('ended');
    expect(engine.current.layers.ticker?.items.map((i) => i.id)).toEqual([kept]);
    // And it still comes off at its time.
    later(8 * MINUTE);
    expect(engine.current.layers.ticker).toBeNull();
    expect(repo.get(kept)?.status).toBe('ended');
  });
});
