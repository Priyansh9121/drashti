import { describe, expect, it } from 'vitest';
import { type EngineCommand } from '../../shared/engine/commands';
import { EngineMirror } from '../../shared/engine/mirror';
import { type EnginePatchMessage } from '../../shared/engine/protocol';
import { LAYER_NAMES } from '../../shared/engine/state';
import { ShowEngine } from './show-engine';
import { makeSource, RecordingTransport, textSlide } from './testing';

function setup() {
  const source = makeSource();
  const transport = new RecordingTransport();
  let clock = 1000;
  const engine = new ShowEngine(source, transport, () => ++clock);
  return { source, transport, engine };
}

const goLive = (presentationId: string, slideIndex: number): EngineCommand => ({
  type: 'goLive',
  presentationId,
  slideIndex,
});

describe('ShowEngine', () => {
  it('starts at revision 0 with an empty snapshot', () => {
    const { engine, transport } = setup();
    const snap = engine.snapshot();
    expect(snap).toMatchObject({ kind: 'snapshot', version: 1, rev: 0 });
    expect(snap.state.layers.slide).toBeNull();
    expect(transport.messages).toHaveLength(0);
  });

  describe('goLive', () => {
    it('shows the slide and broadcasts one patch', () => {
      const { engine, transport } = setup();
      expect(engine.dispatch(goLive('p1', 1))).toEqual({ ok: true, changed: true, rev: 1 });
      expect(engine.current.live).toEqual({ presentationId: 'p1', slideIndex: 1, slideCount: 3 });
      expect(engine.current.layers.slide?.slide).toEqual(textSlide('p1s2', 'Two'));
      const patch = transport.last as EnginePatchMessage;
      expect(patch).toMatchObject({ kind: 'patch', version: 1, baseRev: 0, rev: 1 });
      expect(patch.ops.map((o) => o.path.join('.')).sort()).toEqual(['layers.slide', 'live']);
      expect(patch.ops.find((o) => o.path[0] === 'live')?.value).toEqual(engine.current.live);
    });

    it('rejects an unknown presentation without broadcasting', () => {
      const { engine, transport } = setup();
      expect(engine.dispatch(goLive('nope', 0))).toMatchObject({ ok: false, error: 'unknown-presentation' });
      expect(transport.messages).toHaveLength(0);
      expect(engine.rev).toBe(0);
    });

    it('rejects a slide index past the end', () => {
      const { engine } = setup();
      expect(engine.dispatch(goLive('p1', 3))).toMatchObject({ ok: false, error: 'slide-out-of-range' });
      expect(engine.dispatch(goLive('empty', 0))).toMatchObject({ ok: false, error: 'slide-out-of-range' });
    });

    it('does not broadcast when the same slide is already live', () => {
      const { engine, transport } = setup();
      engine.dispatch(goLive('p1', 0));
      expect(engine.dispatch(goLive('p1', 0))).toEqual({ ok: true, changed: false, rev: 1 });
      expect(transport.messages).toHaveLength(1);
    });

    it('switches presentations', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 2));
      engine.dispatch(goLive('p2', 0));
      expect(engine.current.live).toEqual({ presentationId: 'p2', slideIndex: 0, slideCount: 1 });
    });
  });

  describe('next and previous', () => {
    it('need something live', () => {
      const { engine } = setup();
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: false, error: 'nothing-live' });
      expect(engine.dispatch({ type: 'previous' })).toMatchObject({ ok: false, error: 'nothing-live' });
    });

    it('move one slide at a time', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      engine.dispatch({ type: 'next' });
      expect(engine.current.live.slideIndex).toBe(1);
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.slide?.slide.id).toBe('p1s3');
      engine.dispatch({ type: 'previous' });
      expect(engine.current.live.slideIndex).toBe(1);
    });

    it('stay put at either end', () => {
      const { engine, transport } = setup();
      engine.dispatch(goLive('p1', 2));
      expect(engine.dispatch({ type: 'next' })).toEqual({ ok: true, changed: false, rev: 1 });
      engine.dispatch(goLive('p1', 0));
      expect(engine.dispatch({ type: 'previous' })).toEqual({ ok: true, changed: false, rev: 2 });
      expect(transport.messages).toHaveLength(2);
    });

    it('continue from the cursor after the slide was cleared', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      engine.dispatch({ type: 'clearLayer', layer: 'slide' });
      expect(engine.current.layers.slide).toBeNull();
      engine.dispatch({ type: 'next' });
      expect(engine.current.layers.slide?.slideIndex).toBe(1);
    });

    it('cope with a presentation that got shorter', () => {
      const { engine, source } = setup();
      engine.dispatch(goLive('p1', 2));
      source.set('p1', [textSlide('a', 'A')]);
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
      engine.dispatch({ type: 'previous' });
      expect(engine.current.live).toEqual({ presentationId: 'p1', slideIndex: 0, slideCount: 1 });
    });

    it('report a presentation that was deleted', () => {
      const { engine, source, transport } = setup();
      engine.dispatch(goLive('p2', 0));
      source.delete('p2');
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: false, error: 'unknown-presentation' });
      expect(engine.dispatch({ type: 'previous' })).toMatchObject({
        ok: false,
        error: 'unknown-presentation',
      });
      expect(transport.messages).toHaveLength(1);
    });

    it('do nothing on an empty presentation', () => {
      const { engine, source } = setup();
      engine.dispatch(goLive('p2', 0));
      source.set('p2', []);
      expect(engine.dispatch({ type: 'next' })).toMatchObject({ ok: true, changed: false });
    });
  });

  describe('clear actions', () => {
    function populated() {
      const s = setup();
      const commands: EngineCommand[] = [
        goLive('p1', 0),
        { type: 'playAudio', audio: { id: 'a', title: 'Dhun', mediaId: null } },
        { type: 'setBackground', background: { kind: 'color', color: '#202020' } },
        { type: 'showProp', prop: { id: 'logo', name: 'Logo', elements: [] } },
        { type: 'showMessage', message: { id: 'm', text: 'Welcome' } },
        { type: 'setMask', mask: { id: 'k', name: 'Mask', visible: { x: 0, y: 0, width: 10, height: 10 } } },
      ];
      for (const c of commands) s.engine.dispatch(c);
      return s;
    }

    it.each(LAYER_NAMES)('clearLayer %s empties that layer only, in one patch', (layer) => {
      const { engine, transport } = populated();
      const before = engine.current;
      const result = engine.dispatch({ type: 'clearLayer', layer });
      expect(result).toMatchObject({ ok: true, changed: true });
      const value = engine.current.layers[layer];
      expect(Array.isArray(value) ? value : value === null ? [] : ['not cleared']).toEqual([]);
      for (const other of LAYER_NAMES)
        if (other !== layer) expect(engine.current.layers[other]).toBe(before.layers[other]);
      const patch = transport.last as EnginePatchMessage;
      expect(patch.ops).toEqual([{ path: ['layers', layer], value: Array.isArray(value) ? [] : null }]);
    });

    it.each(LAYER_NAMES)('clearLayer %s on an empty layer changes nothing', (layer) => {
      const { engine, transport } = setup();
      expect(engine.dispatch({ type: 'clearLayer', layer })).toEqual({ ok: true, changed: false, rev: 0 });
      expect(transport.messages).toHaveLength(0);
    });

    it('clearAll empties every layer, keeps the cursor, and sends one patch', () => {
      const { engine, transport } = populated();
      const count = transport.messages.length;
      engine.dispatch({ type: 'clearAll' });
      expect(engine.current.layers).toEqual({
        audio: null,
        background: null,
        slide: null,
        props: [],
        messages: [],
        masks: null,
      });
      expect(engine.current.live.presentationId).toBe('p1');
      expect(transport.messages).toHaveLength(count + 1);
    });
  });

  describe('black-out', () => {
    it('toggles and sets without touching layers', () => {
      const { engine } = setup();
      engine.dispatch(goLive('p1', 0));
      const slide = engine.current.layers.slide;
      engine.dispatch({ type: 'toggleBlackout' });
      expect(engine.current.blackout).toBe(true);
      expect(engine.current.layers.slide).toBe(slide);
      expect(engine.dispatch({ type: 'setBlackout', on: true })).toMatchObject({ changed: false });
      engine.dispatch({ type: 'toggleBlackout' });
      expect(engine.current.blackout).toBe(false);
    });
  });

  describe('other layers', () => {
    it('shows and hides props and messages', () => {
      const { engine } = setup();
      engine.dispatch({ type: 'showProp', prop: { id: 'logo', name: 'Logo', elements: [] } });
      engine.dispatch({ type: 'showMessage', message: { id: 'm', text: 'Hello' } });
      expect(engine.current.layers.props).toHaveLength(1);
      engine.dispatch({ type: 'hideProp', propId: 'logo' });
      engine.dispatch({ type: 'hideMessage', messageId: 'm' });
      expect(engine.current.layers.props).toEqual([]);
      expect(engine.current.layers.messages).toEqual([]);
    });
  });

  it('keeps a mirror identical through snapshots and patches', () => {
    const { engine, transport } = setup();
    const mirror = new EngineMirror();
    expect(mirror.apply(engine.snapshot())).toBe('applied');
    const commands: EngineCommand[] = [
      goLive('p1', 0),
      { type: 'next' },
      { type: 'toggleBlackout' },
      { type: 'showMessage', message: { id: 'm', text: 'Hi' } },
      { type: 'clearLayer', layer: 'slide' },
      { type: 'next' },
      { type: 'clearAll' },
    ];
    for (const c of commands) {
      engine.dispatch(c);
      const m = transport.last;
      if (m) mirror.apply(m);
      expect(mirror.state).toEqual(engine.current);
      expect(mirror.rev).toBe(engine.rev);
    }
  });

  it('stays in sync over a long random sequence, with every message JSON round-tripped', () => {
    const { engine, transport } = setup();
    const mirror = new EngineMirror();
    mirror.apply(JSON.parse(JSON.stringify(engine.snapshot())) as ReturnType<typeof engine.snapshot>);
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pick = (): EngineCommand => {
      const layers = LAYER_NAMES;
      const options: EngineCommand[] = [
        goLive(rand(2) ? 'p1' : 'p2', rand(3)),
        { type: 'next' },
        { type: 'previous' },
        { type: 'clearLayer', layer: layers[rand(layers.length)] ?? 'slide' },
        { type: 'clearAll' },
        { type: 'toggleBlackout' },
        { type: 'setBackground', background: { kind: 'color', color: rand(2) ? '#111111' : '#222222' } },
        { type: 'showMessage', message: { id: `m${rand(3)}`, text: `Text ${rand(5)}` } },
        { type: 'hideMessage', messageId: `m${rand(3)}` },
        { type: 'showProp', prop: { id: `p${rand(2)}`, name: 'P', elements: [] } },
        { type: 'hideProp', propId: `p${rand(2)}` },
        { type: 'playAudio', audio: { id: 'a', title: `T${rand(2)}`, mediaId: null } },
        {
          type: 'setMask',
          mask: { id: 'k', name: 'k', visible: { x: rand(5), y: 0, width: 10, height: 10 } },
        },
      ];
      return options[rand(options.length)] ?? { type: 'next' };
    };
    let seen = 0;
    for (let i = 0; i < 500; i++) {
      engine.dispatch(pick());
      for (; seen < transport.messages.length; seen++) {
        const wire = JSON.parse(JSON.stringify(transport.messages[seen])) as EnginePatchMessage;
        expect(mirror.apply(wire)).toBe('applied');
      }
      expect(mirror.state).toEqual(engine.current);
    }
    expect(engine.rev).toBeGreaterThan(100);
  });

  it('stamps each message with the send time', () => {
    const { engine, transport } = setup();
    engine.dispatch(goLive('p1', 0));
    engine.dispatch({ type: 'next' });
    const times = transport.messages.map((m) => m.sentAt);
    expect(times[1]).toBeGreaterThan(times[0] ?? Infinity);
  });
});
