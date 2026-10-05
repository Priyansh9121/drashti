import { describe, expect, it } from 'vitest';
import type { EngineCommand } from '../../shared/engine/commands';
import { NO_LOOK } from '../../shared/looks';
import type { MacroAction } from '../../shared/macros';
import type { MessageTemplate } from '../../shared/messages';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { openDatabase } from '../db/database';
import { LookRepo } from '../db/looks';
import { MacroRepo } from '../db/macros';
import { MemoryPlaylistSource } from '../engine/playlist-source';
import { ShowEngine } from '../engine/show-engine';
import { makeSource, RecordingTransport, textSlide } from '../engine/testing';
import { LookService } from '../looks/look-service';
import { MacroService } from './macro-service';

/* Macros: actions run in order as one change, checked when saved and again when run. Placeholder content. */

function setup(options: { simple?: boolean } = {}) {
  const db = openDatabase(':memory:');
  const lookRepo = new LookRepo(db);
  const source = makeSource();
  const playlists = new MemoryPlaylistSource();
  playlists.set('sabha', [
    {
      id: 'i-p1',
      kind: 'presentation',
      presentationId: 'p1',
      arrangementId: undefined,
      label: 'Placeholder p1',
    },
    {
      id: 'i-p2',
      kind: 'presentation',
      presentationId: 'p2',
      arrangementId: undefined,
      label: 'Placeholder p2',
    },
  ]);
  const transport = new RecordingTransport();
  let simple = options.simple === true;
  let looks: LookService | null = null;
  let macros: MacroService | null = null;
  const engine = new ShowEngine(source, transport, Date.now, playlists, {
    looks: { look: (id) => looks?.look(id) ?? null, start: () => looks?.start() ?? NO_LOOK },
    refuse: (c) => (simple && c.type === 'setLook' ? SIMPLE_MODE_REFUSAL : null),
    macroCommands: (id) => macros?.commands(id) ?? { ok: false, message: 'not ready' },
  });
  looks = new LookService({ repo: lookRepo, engine, changed: () => undefined, log: () => undefined });
  engine.refreshLook();
  lookRepo.create('Placeholder evening');
  const evening = lookRepo.list()[1]?.id ?? '';
  const template: MessageTemplate = {
    id: 'car',
    name: 'Car',
    template: 'Car {plate} please move',
    fields: {},
  };
  const repo = new MacroRepo(db);
  const service = new MacroService({
    repo,
    engine: { state: () => engine.current, runMacro: (c) => engine.runMacro(c) },
    reads: {
      prop: (id) => (id === 'logo' ? { id: 'logo', name: 'Placeholder logo', elements: [] } : null),
      template: (id) => (id === 'car' ? template : null),
      media: (id) => (id === 'dhun' ? { kind: 'audio', name: 'Placeholder dhun.mp3' } : null),
      logo: () => ({ id: 'logo', name: 'Placeholder logo', elements: [] }),
    },
    simple: () => simple,
    changed: () => undefined,
    log: () => undefined,
  });
  macros = service;
  return {
    db,
    engine,
    source,
    transport,
    repo,
    macros: service,
    evening,
    setSimple: (on: boolean) => {
      simple = on;
    },
  };
}

const ARTI: MacroAction[] = [
  { kind: 'clearAll' },
  { kind: 'showProp', propId: 'logo' },
  { kind: 'showMessage', templateId: 'car', values: { plate: '12' } },
  { kind: 'playSound', mediaId: 'dhun', volume: 0.8, loop: true },
  { kind: 'backgroundColor', color: '#102030' },
  { kind: 'stageMessage', text: 'Placeholder: arti next' },
  { kind: 'blackout', to: 'off' },
  { kind: 'playItem', playlistId: 'sabha', itemId: 'i-p2' },
];

const made = (t: ReturnType<typeof setup>, actions: unknown[], name = 'Placeholder arti') => {
  const r = t.macros.save(null, { name, color: '#3e63dd', actions });
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

describe('macros', () => {
  it('run every action in order as one change: one patch, one revision', () => {
    const t = setup();
    t.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
    const id = made(t, [{ kind: 'look', lookId: t.evening }, ...ARTI]);
    const before = t.engine.rev;
    const sent = t.transport.messages.length;
    expect(t.macros.run(id)).toEqual({ ok: true, rev: before + 1, changed: true });
    expect(t.transport.messages.length).toBe(sent + 1);
    const s = t.engine.current;
    expect(s.look.id).toBe(t.evening);
    expect(s.layers.props.map((p) => p.id)).toEqual(['logo']);
    expect(s.layers.messages.map((m) => m.text)).toEqual(['Car 12 please move']);
    expect(s.layers.audio).toMatchObject({ mediaId: 'dhun', volume: 0.8, loop: true });
    expect(s.layers.background).toEqual({ kind: 'color', color: '#102030' });
    expect(s.stageMessage).toBe('Placeholder: arti next');
    expect(s.live.playlist).toEqual({ playlistId: 'sabha', itemId: 'i-p2' });
    expect(s.layers.slide?.presentationId).toBe('p2');
  });

  it('can be put back when it cleared all (to what was up before it); Back after one is Previous', () => {
    const t = setup();
    t.engine.dispatch({ type: 'goLive', presentationId: 'p1', slideIndex: 1 });
    t.engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#ff0000' } });
    const clears = made(t, [{ kind: 'clearAll' }, { kind: 'showProp', propId: 'logo' }]);
    t.macros.run(clears);
    expect(t.engine.current.layers.slide).toBeNull();
    expect(t.engine.current.canPutBack).toBe(true);
    t.engine.dispatch({ type: 'putBack' });
    expect(t.engine.current.layers.slide?.slideIndex).toBe(1);
    expect(t.engine.current.layers.background).toEqual({ kind: 'color', color: '#ff0000' });
    expect(t.engine.current.layers.props).toEqual([]);
    // A macro without Clear all: nothing to put back; Back is Previous.
    const prop = made(t, [{ kind: 'showProp', propId: 'logo' }], 'Placeholder logo up');
    t.engine.dispatch({ type: 'next' });
    t.macros.run(prop);
    expect(t.engine.current.canPutBack).toBe(false);
    t.engine.dispatch({ type: 'back' });
    expect(t.engine.current.layers.slide?.slideIndex).toBe(1);
    expect(t.engine.current.layers.props.map((p) => p.id)).toEqual(['logo']);
  });

  it('refuse what a macro may not do when saved, and again when run', () => {
    const t = setup();
    for (const action of [
      { kind: 'goLiveStream' },
      { kind: 'startRecording' },
      { kind: 'saveSettings', name: 'network.on', value: true },
      { kind: 'removePresentations', ids: ['p1'] },
      { kind: 'look' },
      'clearAll',
    ]) {
      const r = t.macros.save(null, { name: 'Placeholder bad', color: '#3e63dd', actions: [action] });
      expect(r.ok, JSON.stringify(action)).toBe(false);
    }
    expect(
      t.macros.save(null, { name: 'X', color: '#3e63dd', actions: [{ kind: 'goLiveStream' }] }),
    ).toMatchObject({
      message: expect.stringContaining('not something a macro may do') as string,
    });
    // Written behind Drashti's back: refused when it runs, and nothing happens.
    const id = made(t, [{ kind: 'clearAll' }]);
    t.repo.writeRaw(id, [{ kind: 'clearAll' }, { kind: 'endStream' }]);
    const rev = t.engine.rev;
    expect(t.macros.run(id)).toMatchObject({ ok: false });
    expect(t.engine.rev).toBe(rev);
    // A macro naming something gone runs nothing either.
    const gone = made(t, [{ kind: 'clearAll' }, { kind: 'showProp', propId: 'gone' }], 'Placeholder gone');
    expect(t.macros.run(gone)).toMatchObject({
      ok: false,
      message: expect.stringContaining('prop') as string,
    });
    expect(t.engine.rev).toBe(rev);
  });

  it('run from a slide cue in the same change as the slide; never in Simple Mode', () => {
    const t = setup();
    const id = made(t, [
      { kind: 'stageMessage', text: 'Placeholder: cue ran' },
      { kind: 'backgroundColor', color: '#000080' },
    ]);
    t.source.set('cued', [textSlide('c1', 'One'), { ...textSlide('c2', 'Two') }]);
    // The memory source has no macro cues of its own: give the second slide one.
    const order = t.source.order('cued');
    const original = t.source.order.bind(t.source);
    t.source.order = (pid, arr) => {
      const o = original(pid, arr);
      return pid === 'cued' && o
        ? { ...o, slides: o.slides.map((s, i) => (i === 1 ? { ...s, macroId: id } : s)) }
        : o;
    };
    expect(order?.slides).toHaveLength(2);
    t.engine.dispatch({ type: 'goLive', presentationId: 'cued', slideIndex: 0 });
    const rev = t.engine.rev;
    t.engine.dispatch({ type: 'next' });
    expect(t.engine.rev).toBe(rev + 1);
    expect(t.engine.current.stageMessage).toBe('Placeholder: cue ran');
    expect(t.engine.current.layers.background).toEqual({ kind: 'color', color: '#000080' });
    // Back undoes the Next exactly: the layers the cue changed too (the stage message is not a layer, and stays).
    t.engine.dispatch({ type: 'back' });
    expect(t.engine.current.layers.slide?.slideIndex).toBe(0);
    expect(t.engine.current.layers.background).toBeNull();
    expect(t.engine.current.stageMessage).toBe('Placeholder: cue ran');
    // In Simple Mode the slide goes up alone.
    t.setSimple(true);
    t.engine.dispatch({ type: 'clearStageMessage' });
    t.engine.dispatch({ type: 'next' });
    expect(t.engine.current.layers.slide?.slideIndex).toBe(1);
    expect(t.engine.current.stageMessage).toBeNull();
    expect(t.macros.run(id)).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  });

  it('never set each other off: a slide a macro puts up does not run its own cue', () => {
    const t = setup();
    const cue = made(t, [{ kind: 'stageMessage', text: 'Placeholder: should not run' }], 'Placeholder cue');
    const original = t.source.order.bind(t.source);
    t.source.order = (pid, arr) => {
      const o = original(pid, arr);
      return pid === 'p2' && o ? { ...o, slides: o.slides.map((s) => ({ ...s, macroId: cue })) } : o;
    };
    const go = made(t, [{ kind: 'playItem', playlistId: 'sabha', itemId: 'i-p2' }], 'Placeholder go');
    expect(t.macros.run(go)).toMatchObject({ ok: true });
    expect(t.engine.current.layers.slide?.presentationId).toBe('p2');
    expect(t.engine.current.stageMessage).toBeNull();
  });

  it('turn their actions into the engine commands they stand for', () => {
    const t = setup();
    const id = made(t, [
      { kind: 'logo', to: 'toggle' },
      { kind: 'blackout', to: 'toggle' },
      { kind: 'timer', timerId: 't1', how: 'pause' },
      { kind: 'hideMessage', templateId: 'car' },
      { kind: 'clearLayer', layer: 'masks' },
      { kind: 'stageMessage', text: null },
    ]);
    const got = t.macros.commands(id);
    expect(got.ok ? got.commands : got).toEqual([
      { type: 'showLogo', prop: { id: 'logo', name: 'Placeholder logo', elements: [] } },
      { type: 'toggleBlackout' },
      { type: 'pauseTimer', timerId: 't1' },
      { type: 'hideMessage', messageId: 'message:car' },
      { type: 'clearLayer', layer: 'masks' },
      { type: 'clearStageMessage' },
    ] satisfies EngineCommand[]);
  });
});

describe('scheduled macros (Session 14)', () => {
  it('keep their times with the macro; run at a time an admin set, in Simple Mode too, never from a button there', () => {
    const t = setup();
    const r = t.macros.save(null, {
      name: 'Placeholder idle',
      color: '#3e63dd',
      actions: [{ kind: 'idle', to: 'start' }],
      schedules: [{ id: 's1', days: [6], date: null, time: '18:30', enabled: true }],
    });
    if (!r.ok) throw new Error(r.message);
    expect(t.macros.list()[0]?.schedules).toEqual([
      { id: 's1', days: [6], date: null, time: '18:30', enabled: true },
    ]);
    // Saved again without its times, it keeps them.
    expect(t.macros.save(r.id, { name: 'Placeholder idle', color: '#2f9e44', actions: [] }).ok).toBe(true);
    expect(t.macros.list()[0]?.schedules).toHaveLength(1);
    // A time that is not right is refused.
    const bad = t.macros.save(r.id, {
      name: 'Placeholder idle',
      color: '#3e63dd',
      actions: [],
      schedules: [{ id: 's1', days: [], date: null, time: '18:30', enabled: true }],
    });
    expect(bad.ok).toBe(false);
    t.setSimple(true);
    expect(t.macros.run(r.id).ok).toBe(false);
    expect(t.macros.run(r.id, 'its schedule', { scheduled: true }).ok).toBe(true);
  });
});
