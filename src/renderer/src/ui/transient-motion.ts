import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import { leave, motionOff, type Leaving } from './motion';

const copied = new WeakSet<Element>();
const appeared = new WeakSet<Element>();

/** Decide once when a tooltip is placed or a chat card mounts, not when its always-mounted owner renders. */
export function arriveTransient(node: Element | null, kind: 'pop' | 'notice', enabled = true): void {
  if (!(node instanceof HTMLElement) || !node.isConnected || appeared.has(node)) return;
  appeared.add(node);
  if (
    !enabled ||
    !document.body.classList.contains('operator') ||
    !document.documentElement.hasAttribute('data-opened') ||
    motionOff() ||
    node.closest('[data-show-control]') ||
    node.querySelector('[data-show-control]')
  )
    return;
  node.dataset['motion'] = kind;
}

/** Shared UI can be imported before a body exists, including server-rendered Help. */
export function interfaceBody(): HTMLElement | null | undefined {
  return typeof document === 'undefined' ? undefined : document.body;
}

/** Reuse the existing inert exit, without ever carrying a show control or an output into it. */
export function leaveTransient(node: Element | null, kind: Leaving): void {
  if (
    !(node instanceof HTMLElement) ||
    !node.isConnected ||
    !document.body.classList.contains('operator') ||
    !document.documentElement.hasAttribute('data-opened') ||
    motionOff() ||
    node.closest('[data-show-control]') ||
    node.querySelector('[data-show-control]') ||
    copied.has(node)
  )
    return;
  copied.add(node);
  const privatePart = node.closest(`[${REPORT_PRIVATE_ATTR}]`) !== null;
  const previous = document.body.lastElementChild;
  // The real frame never translates. Freeze its visual children's current appearance in the copy,
  // so closing partway through an entrance cannot flash opaque or jump the words to their end.
  const saved = [
    { node, properties: ['opacity'] as const },
    ...[...node.querySelectorAll<HTMLElement>('.motionui-visual, :scope > p, :scope > svg')].map((part) => ({
      node: part,
      properties: ['opacity', 'transform'] as const,
    })),
  ].flatMap(({ node: part, properties }) => {
    const seen = getComputedStyle(part);
    return properties.map((property) => ({
      node: part,
      property,
      value: part.style[property],
      priority: part.style.getPropertyPriority(property),
      seen: seen[property],
    }));
  });
  for (const part of saved) part.node.style.setProperty(part.property, part.seen);
  try {
    leave(node, kind);
  } finally {
    for (const part of saved)
      if (part.value === '') part.node.style.removeProperty(part.property);
      else part.node.style.setProperty(part.property, part.value, part.priority);
  }
  const host = document.body.lastElementChild;
  if (
    privatePart &&
    host instanceof HTMLElement &&
    host !== previous &&
    host.hasAttribute('data-leaving-host')
  ) {
    // Report a Problem must still blank a chat's words while its copy leaves. Its host normally
    // spans the window; bound this private rectangle to the card plus its small travel instead.
    const box = node.getBoundingClientRect();
    const pad = 16;
    host.setAttribute(REPORT_PRIVATE_ATTR, '');
    Object.assign(host.style, {
      inset: 'auto',
      left: `${String(box.left - pad)}px`,
      top: `${String(box.top - pad)}px`,
      width: `${String(box.width + 2 * pad)}px`,
      height: `${String(box.height + 2 * pad)}px`,
    });
  }
}

/** Global CSS cannot reach closed shadows: stopping motion must remove their already-running copies too. */
export function removeTransientCopies(): void {
  if (!motionOff()) return;
  for (const host of document.querySelectorAll('[data-leaving-host]')) host.remove();
}

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  window.document === document &&
  typeof MutationObserver === 'function' &&
  typeof window.matchMedia === 'function' &&
  interfaceBody()?.classList.contains('operator')
) {
  new MutationObserver(removeTransientCopies).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-interface-motion'],
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', removeTransientCopies);
}
