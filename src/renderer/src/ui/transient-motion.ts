import { REPORT_PRIVATE_ATTR } from '../../../shared/report-private';
import { leave, motionOff, type Leaving } from './motion';
import './transient-motion.css';

const copied = new WeakSet<Element>();

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
  // Closing during an entrance must not turn its partly visible copy opaque for a frame.
  const opacity = node.style.opacity;
  const priority = node.style.getPropertyPriority('opacity');
  node.style.setProperty('opacity', getComputedStyle(node).opacity);
  try {
    leave(node, kind);
  } finally {
    if (opacity === '') node.style.removeProperty('opacity');
    else node.style.setProperty('opacity', opacity, priority);
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

if (typeof window !== 'undefined' && document.body.classList.contains('operator')) {
  new MutationObserver(removeTransientCopies).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-interface-motion'],
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', removeTransientCopies);
}
