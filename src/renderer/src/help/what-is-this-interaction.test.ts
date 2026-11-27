import { isValidElement } from 'react';
import type { EffectCallback, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelHelpId } from '../../../shared/panel-help';
import type { Box } from './card-place';
import type { useWhatIsThis } from './WhatIsThis';

/* Exercise the real hook with controlled layout/effect delivery, without a browser or a DOM library. Native Tab
 * walks the fixture's document order; negative tabindex is focusable only by the hook. Windows tests additionally
 * make complete circuits in Chromium and check that an adjacent card cannot hide the focused action. */
interface Props {
  children?: ReactNode;
  ref?: { current: unknown };
  onClick?: () => void;
  tabIndex?: number;
  style?: { left?: number };
  'data-testid'?: string;
  'data-got-it'?: string;
}
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

class Element {
  children: Element[] = [];
  tabIndex = 0;
  isConnected = true;
  offsetWidth = 320;
  offsetHeight = 150;
  clientHeight = 148;
  scrollHeight = 148;
  parentElement = null;
  constructor(
    readonly name: string,
    readonly ownerDocument: Document,
    public rect = box(0, 0, 24, 24),
  ) {}
  contains(at: unknown): boolean {
    return at === this || this.children.some((c) => c.contains(at));
  }
  getClientRects() {
    return this.isConnected ? [this.rect] : [];
  }
  getBoundingClientRect() {
    return this.rect;
  }
  getAttribute(name: string) {
    return name === 'data-zone' ? this.name : null;
  }
  closest() {
    return this.ownerDocument.right;
  }
  querySelectorAll() {
    return this.children;
  }
  querySelector() {
    return this.children.at(-1) ?? null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
    const e = new Event('focusin');
    Object.defineProperty(e, 'target', { value: this });
    this.ownerDocument.dispatchEvent(e);
  }
}

class Document extends EventTarget {
  activeElement: Element | null = null;
  left = new Element('left', this, box(0, 48, 300, 810));
  middle = new Element('middle', this, box(308, 48, 1042, 810));
  right = new Element('right', this, box(1050, 48, 1410, 810));
  body = new Element('body', this);
  querySelectorAll(selector: string) {
    const zone = [this.left, this.middle, this.right].find((el) => selector === `[data-zone="${el.name}"]`);
    return zone ? [zone] : [];
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class Resize {
  static all: Resize[] = [];
  observed = new Set<unknown>();
  constructor(readonly notify: () => void) {
    Resize.all.push(this);
  }
  observe(el: unknown) {
    this.observed.add(el);
  }
  disconnect() {
    this.observed.clear();
  }
  static deliver(el: unknown) {
    for (const observer of Resize.all) if (observer.observed.has(el)) observer.notify();
  }
}

interface Effect {
  deps: readonly unknown[];
  run: EffectCallback;
  stop?: (() => void) | undefined;
  pending: boolean;
}
let current: Card;
let doc: Document;
let win: EventTarget & { innerWidth: number; innerHeight: number };
let renderCard: typeof useWhatIsThis;
const cards: Card[] = [];
function nodes(tree: ReactNode): Props[] {
  if (Array.isArray(tree)) return (tree as ReactNode[]).flatMap(nodes);
  if (!isValidElement<Props>(tree)) return [];
  return [tree.props, ...nodes(tree.props.children)];
}

class Card {
  cursor = 0;
  slots: unknown[] = [];
  effects = new Map<number, Effect>();
  dirty = false;
  tree: ReactNode = null;
  ask: Element;
  card: Element;
  manual: Element;
  got: Element;
  constructor(readonly topic: PanelHelpId) {
    this.ask = new Element(`${topic} ?`, doc, box(1370, 220, 1394, 244));
    this.card = new Element(`${topic} card`, doc);
    this.manual = new Element(`${topic} manual`, doc);
    this.got = new Element(`${topic} Got it`, doc);
    cards.push(this);
    this.draw();
  }
  draw() {
    do {
      this.dirty = false;
      this.cursor = 0;
      selectCard(this.topic);
      this.tree = renderCard(this.topic).button;
      for (const props of nodes(this.tree)) {
        if (props['data-testid'] === `what-is-this-${this.topic}` && props.ref) props.ref.current = this.ask;
        if (props['data-testid'] === 'what-is-this' && props.ref) props.ref.current = this.card;
        if (props['data-testid'] === 'what-is-this-manual') this.manual.tabIndex = props.tabIndex ?? 0;
        if (props['data-got-it'] !== undefined) this.got.tabIndex = props.tabIndex ?? 0;
      }
      this.card.children = this.shown ? [this.manual, this.got] : [];
      for (const effect of this.effects.values())
        if (effect.pending) {
          effect.pending = false;
          effect.stop?.();
          const stop = effect.run();
          effect.stop = typeof stop === 'function' ? stop : undefined;
        }
    } while (this.pendingRender);
  }
  get pendingRender() {
    return this.dirty;
  }
  get shown() {
    return nodes(this.tree).some((p) => p['data-testid'] === 'what-is-this');
  }
  get left() {
    return nodes(this.tree).find((p) => p['data-testid'] === 'what-is-this')?.style?.left ?? -9999;
  }
  enter() {
    expect(doc.activeElement).toBe(this.ask);
    nodes(this.tree)
      .find((p) => p['data-testid'] === `what-is-this-${this.topic}`)
      ?.onClick?.();
    flush();
  }
  open() {
    this.ask.focus();
    this.enter();
  }
  stop() {
    for (const effect of this.effects.values()) effect.stop?.();
  }
}
function selectCard(topic: PanelHelpId) {
  const card = cards.find((candidate) => candidate.topic === topic);
  if (!card) throw new Error(`No card fixture for ${topic}`);
  current = card;
}
function flush() {
  for (const card of cards) card.draw();
}
function effect(run: Effect['run'], deps: readonly unknown[]) {
  const index = current.cursor++;
  const was = current.effects.get(index);
  if (!was || deps.some((dep, i) => !Object.is(dep, was.deps[i])))
    current.effects.set(index, { deps, run, stop: was?.stop, pending: true });
}
function tab(order: Element[], backward = false) {
  const e = new Event('keydown', { cancelable: true });
  Object.assign(e, { key: 'Tab', shiftKey: backward, ctrlKey: false, metaKey: false, altKey: false });
  doc.dispatchEvent(e);
  if (!e.defaultPrevented) {
    const native = [...order, ...cards.filter((c) => c.shown).flatMap((c) => [c.manual, c.got])].filter(
      (el) => el.tabIndex >= 0,
    );
    const active = doc.activeElement;
    const at = active === null ? -1 : native.indexOf(active);
    native[(at + (backward ? -1 : 1) + native.length) % native.length]?.focus();
  }
  vi.runOnlyPendingTimers();
  flush();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  doc = new Document();
  win = Object.assign(new EventTarget(), { innerWidth: 1410, innerHeight: 900 });
  Resize.all = [];
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('Node', Element);
  vi.stubGlobal('ResizeObserver', Resize);
  vi.doMock('react', async (original) => ({
    ...(await original<object>()),
    useId: () => current.topic,
    useState: (initial: unknown) => {
      const card = current;
      const index = card.cursor++;
      if (!(index in card.slots)) card.slots[index] = initial;
      return [
        card.slots[index],
        (value: unknown) => {
          const next =
            typeof value === 'function' ? (value as (before: unknown) => unknown)(card.slots[index]) : value;
          if (!Object.is(next, card.slots[index])) {
            card.slots[index] = next;
            card.dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = current.cursor++;
      return (current.slots[index] ??= { current: initial });
    },
    useEffect: effect,
    useLayoutEffect: effect,
  }));
  vi.doMock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
  vi.doMock('../operator/mode-store', () => ({
    useMode: (select: (s: { mode: string }) => unknown) => select({ mode: 'pro' }),
  }));
  vi.doMock('./help-store', () => ({
    useHelp: Object.assign(
      (select: (s: { on: boolean; round: number }) => unknown) => select({ on: true, round: 0 }),
      { subscribe: () => () => undefined },
    ),
  }));
  ({ useWhatIsThis: renderCard } = await import('./WhatIsThis'));
});
afterEach(() => {
  for (const card of cards) card.stop();
  cards.length = 0;
  for (const module of ['react', 'react-dom', '../operator/mode-store', './help-store']) vi.doUnmock(module);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('an open help card', () => {
  it('has one place beside its ? in a complete forward and backward Tab circuit (MUST-1)', () => {
    const card = new Card('live');
    const header = new Element('header', doc);
    const playlists = new Element('Playlists', doc);
    const slides = new Element('Slides', doc);
    const after = new Element('Live after ?', doc);
    const show = new Element('Show controls', doc);
    const status = new Element('Status', doc);
    const order = [header, playlists, slides, card.ask, after, show, status];
    card.open();
    for (const backward of [false, true]) {
      header.focus();
      const seen: string[] = [];
      for (let i = 0; i < 20; i++) {
        tab(order, backward);
        if (doc.activeElement === header) break;
        seen.push(doc.activeElement?.name ?? 'BODY');
      }
      const forward = [
        'Playlists',
        'Slides',
        'live ?',
        'live manual',
        'live Got it',
        'Live after ?',
        'Show controls',
        'Status',
      ];
      expect(seen, backward ? 'backward circuit' : 'forward circuit').toEqual(
        backward ? forward.toReversed() : forward,
      );
      expect(doc.activeElement).toBe(header);
      expect(card.shown).toBe(true);
    }
  });

  it('closes the previous card when the next ? is activated without a pointer (MUST-2)', () => {
    const midi = new Card('midi');
    const osc = new Card('osc');
    const oscToggle = new Element('OSC heading', doc);
    const order = [midi.ask, oscToggle, osc.ask];
    midi.open();
    tab(order);
    expect(doc.activeElement).toBe(oscToggle);
    tab(order);
    expect(doc.activeElement).toBe(osc.ask);
    osc.enter();
    expect(cards.filter((c) => c.shown).map((c) => c.topic)).toEqual(['osc']);
    expect(doc.activeElement).toBe(osc.got);
    tab(order, true);
    expect(doc.activeElement).toBe(osc.manual);
    tab(order, true);
    expect(doc.activeElement).toBe(osc.ask);
    tab(order, true);
    expect(doc.activeElement).toBe(oscToggle);
    tab(order, true);
    expect(doc.activeElement).toBe(midi.ask);
  });

  it('follows column layout delivered after the native resize, retaining Got it focus (SHOULD-1)', () => {
    const card = new Card('live');
    card.open();
    win.innerWidth = 1024;
    win.innerHeight = 645;
    win.dispatchEvent(new Event('resize'));
    flush();
    // React lays out Columns after the native event has already measured the old middle width.
    doc.left.rect = box(0, 48, 220, 560);
    doc.middle.rect = box(228, 48, 716, 560);
    doc.right.rect = box(724, 48, 1024, 560);
    card.ask.rect = box(990, 220, 1014, 244);
    Resize.deliver(doc.middle);
    flush();
    expect(
      card.left + card.card.offsetWidth,
      'the card stays clear of the resized LIVE column',
    ).toBeLessThanOrEqual(doc.right.rect.left);
    expect(doc.activeElement).toBe(card.got);
  });
});
