import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Recovery choices and timing, with a small DOM stand-in (the real Chromium keyboard, scroll and ring checks are in
 * focus-keeper.spec.ts). Removal here deliberately emits no focusout: DOM removal is not a dependable blur signal.
 */
class Element extends EventTarget {
  readonly children: Element[] = [];
  readonly attrs = new Map<string, string>();
  parentElement: Element | null = null;
  readonly dataset: Record<string, string> = {};
  constructor(readonly tagName: string) {
    super();
  }
  get isConnected(): boolean {
    return page.body.contains(this);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'data-testid') this.dataset['testid'] = value;
    page.mutate({ type: 'attributes', target: this, attributeName: name });
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    page.mutate({ type: 'attributes', target: this, attributeName: name });
  }
  contains(el: Element): boolean {
    return el === this || this.children.some((child) => child.contains(el));
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      let s = part.trim();
      let excluded = false;
      s = s.replace(/:not\(([^)]+)\)/gu, (_, inner: string) => {
        excluded ||= this.matches(inner);
        return '';
      });
      if (excluded) return false;
      if (s.includes(':disabled')) {
        if (!this.hasAttribute('disabled')) return false;
        s = s.replace(':disabled', '');
      }
      const tag = /^[a-z][a-z0-9-]*/iu.exec(s)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      for (const [, name, value] of s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/gu)) {
        if (name === undefined || !this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
    });
  }
  closest(selector: string): Element | null {
    for (let at: Element | null = this; at; at = at.parentElement) if (at.matches(selector)) return at;
    return null;
  }
  getClientRects(): object[] {
    return this.isConnected && this.closest('[hidden]') === null ? [{}] : [];
  }
  focus(): void {
    if (
      !this.isConnected ||
      this.closest('[disabled], [hidden], [inert]') ||
      !this.matches('button, input, select, textarea, a[href], [tabindex]')
    )
      return;
    const before = page.activeElement;
    if (before === this) return;
    page.activeElement = this;
    before.dispatchEvent(new Event('blur'));
    page.emit('focusout', { target: before, relatedTarget: this });
    page.emit('focusin', { target: this });
  }
  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
    if (this.contains(page.activeElement)) page.activeElement = page.body;
    page.mutate({ type: 'childList', target: parent, removedNodes: [this] });
  }
}

class Page {
  readonly body = new Element('BODY');
  activeElement = this.body;
  readonly listeners = new Map<string, ((e: object) => void)[]>();
  readonly frames: FrameRequestCallback[] = [];
  observer: { callback: (records: object[]) => void; options: MutationObserverInit } | null = null;
  node(tag: string, attrs: Record<string, string> = {}, parent = this.body): Element {
    const el = new Element(tag.toUpperCase());
    parent.children.push(el);
    el.parentElement = parent;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }
  querySelectorAll(selector: string): Element[] {
    const descend = (el: Element): Element[] => el.children.flatMap((child) => [child, ...descend(child)]);
    return descend(this.body).filter((el) => el.matches(selector));
  }
  addEventListener(type: string, callback: (e: object) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, event: object): void {
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }
  mutate(record: { type: string; attributeName?: string; target: Element; removedNodes?: Element[] }): void {
    const observer = this.observer;
    if (!observer) return;
    if (record.type === 'childList' && observer.options.childList !== true) return;
    if (record.type === 'attributes' && !observer.options.attributeFilter?.includes(record.attributeName ?? ''))
      return;
    observer.callback([record]);
  }
  frame(): void {
    const callbacks = this.frames.splice(0);
    for (const callback of callbacks) callback(0);
  }
  settle(): void {
    this.frame();
    this.frame();
  }
}

let page: Page;
let keeper: typeof import('./focus-keeper');
const html = (el: Element) => el as unknown as HTMLElement;

beforeEach(async () => {
  vi.resetModules();
  page = new Page();
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', page);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => page.frames.push(callback));
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(readonly callback: (records: object[]) => void) {}
      observe(_target: unknown, options: MutationObserverInit): void {
        page.observer = { callback: this.callback, options };
      }
    },
  );
  keeper = await import('./focus-keeper');
});

afterEach(() => vi.unstubAllGlobals());

describe('the operator focus keeper', () => {
  it('installs once without drawing, scheduling or taking the keyboard', () => {
    keeper.installFocusKeeper();
    keeper.installFocusKeeper();
    expect(page.listeners.get('focusin')).toHaveLength(1);
    expect(page.frames).toHaveLength(0);
    expect(page.activeElement).toBe(page.body);
  });

  it('recovers a removed control without a focusout, in its group, after giving local recovery two frames', () => {
    const group = page.node('div', { role: 'group', 'aria-label': 'Clear one layer' });
    const clear = page.node('button', {}, group);
    const otherShowControl = page.node('button', {}, group);
    keeper.installFocusKeeper();
    clear.focus();
    clear.remove();
    page.frame();
    expect(page.activeElement).toBe(page.body);
    page.frame();
    expect(page.activeElement).toBe(group);
    expect(group.getAttribute('tabindex')).toBe('-1');
    expect(group.hasAttribute('data-focus-kept')).toBe(true);
    otherShowControl.focus();
    expect(group.hasAttribute('tabindex')).toBe(false);
    expect(group.hasAttribute('data-focus-kept')).toBe(false);
  });

  it('recovers a disabled control even if Chromium still calls it the active element', () => {
    const foot = page.node('footer', { 'aria-label': 'Show controls' });
    const clear = page.node('button', {}, foot);
    keeper.installFocusKeeper();
    clear.focus();
    clear.setAttribute('disabled', '');
    page.settle();
    expect(page.activeElement).toBe(foot);
  });

  it('leaves a component or an operator the focus they chose during the two frames', () => {
    const main = page.node('main');
    const removed = page.node('button', {}, main);
    const chosen = page.node('button', {}, main);
    keeper.installFocusKeeper();
    removed.focus();
    removed.remove();
    page.frame();
    chosen.focus();
    page.frame();
    expect(page.activeElement).toBe(chosen);
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves a list its own recovery while it exists, and recovers its region if the whole list goes', () => {
    const main = page.node('main');
    const list = page.node('ul', { tabindex: '-1' }, main);
    const row = page.node('button', {}, list);
    keeper.installFocusKeeper();
    row.focus();
    row.setAttribute('disabled', '');
    page.settle();
    expect(page.activeElement).toBe(row);
    list.remove();
    page.settle();
    expect(page.activeElement).toBe(main);
  });

  it('keeps focus in the new header when the old mode and its header go together', () => {
    const mode = page.node('div');
    const header = page.node('header', {}, mode);
    const button = page.node('button', {}, header);
    keeper.installFocusKeeper();
    button.focus();
    mode.remove();
    const next = page.node('header');
    page.settle();
    expect(page.activeElement).toBe(next);
  });

  it('prefers the same control made again, but never guesses between duplicate test ids', () => {
    const main = page.node('main');
    const old = page.node('button', { 'data-testid': 'placeholder-action' }, main);
    keeper.installFocusKeeper();
    old.focus();
    old.remove();
    const replacement = page.node('button', { 'data-testid': 'placeholder-action' }, main);
    page.settle();
    expect(page.activeElement).toBe(replacement);
    replacement.remove();
    page.node('button', { 'data-testid': 'placeholder-action' }, main);
    page.node('button', { 'data-testid': 'placeholder-action' }, main);
    page.settle();
    expect(page.activeElement).toBe(main);
  });

  it('records a vanished dialog opener and returns to its region when the dialog closes', () => {
    const status = page.node('footer', { 'aria-label': 'Status' });
    const opener = page.node('button', {}, status);
    keeper.installFocusKeeper();
    opener.focus();
    opener.remove();
    expect(keeper.focusOrigin()).toBe(opener);
    const dialog = page.node('div', { role: 'dialog', 'aria-modal': 'true' });
    const close = page.node('button', {}, dialog);
    close.focus();
    page.settle();
    expect(page.activeElement).toBe(close);
    dialog.remove();
    keeper.giveFocusBack(html(opener));
    expect(page.activeElement).toBe(status);
  });

  it('remembers the outside opener when autofocus ran before the dialog trap effect', () => {
    const header = page.node('header');
    const opener = page.node('button', {}, header);
    keeper.installFocusKeeper();
    opener.focus();
    const dialog = page.node('div', { role: 'dialog', 'aria-modal': 'true' });
    const field = page.node('input', {}, dialog);
    field.focus();
    const before = keeper.focusOrigin(html(dialog));
    expect(before).toBe(opener);
    dialog.remove();
    if (before) keeper.giveFocusBack(before);
    expect(page.activeElement).toBe(opener);
  });

  it('a nested autofocus dialog returns to its opener in the outer dialog', () => {
    const header = page.node('header');
    const opener = page.node('button', {}, header);
    keeper.installFocusKeeper();
    opener.focus();
    const outer = page.node('div', { role: 'dialog', 'aria-modal': 'true' });
    const nestedOpener = page.node('button', {}, outer);
    nestedOpener.focus();
    const inner = page.node('div', { role: 'dialog', 'aria-modal': 'true' });
    // Before the new dialog takes focus, the current control is the nested opener.
    expect(keeper.focusOrigin(html(inner))).toBe(nestedOpener);
    page.node('input', {}, inner).focus();
    const before = keeper.focusOrigin(html(inner));
    expect(before).toBe(nestedOpener);
    inner.remove();
    if (before) keeper.giveFocusBack(before);
    expect(page.activeElement).toBe(nestedOpener);
  });

  it('never recovers to the page behind an open modal', () => {
    const main = page.node('main');
    const opener = page.node('button', {}, main);
    keeper.installFocusKeeper();
    opener.focus();
    opener.remove();
    page.node('div', { role: 'dialog', 'aria-modal': 'true' });
    page.settle();
    expect(page.activeElement).toBe(page.body);
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('marks an existing focusable region while kept, then preserves its original tabindex on blur', () => {
    const group = page.node('div', { role: 'group', 'aria-label': 'Placeholder group', tabindex: '0' });
    const control = page.node('button', {}, group);
    const next = page.node('button');
    keeper.installFocusKeeper();
    control.focus();
    control.setAttribute('disabled', '');
    page.settle();
    expect(page.activeElement).toBe(group);
    expect(group.hasAttribute('data-focus-kept')).toBe(true);
    next.focus();
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(group.hasAttribute('data-focus-kept')).toBe(false);
  });

  it('does not add operator recovery in another window, but returns to a connected dialog opener there', () => {
    const main = page.node('main');
    const opener = page.node('button', {}, main);
    keeper.rememberPlace(html(opener));
    keeper.giveFocusBack(html(opener));
    expect(page.activeElement).toBe(opener);
    opener.remove();
    keeper.giveFocusBack(html(opener));
    expect(page.activeElement).toBe(page.body);
    expect(keeper.focusOrigin()).toBeNull();
  });
});
