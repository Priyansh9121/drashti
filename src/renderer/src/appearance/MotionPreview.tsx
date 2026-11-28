import type { InterfaceMotion } from '../../../shared/appearance/appearances';

/** Decoration only: a fixed miniature, sampled once on hover or keyboard focus, never a show/output renderer. */
export function MotionPreview({ motion }: { motion: InterfaceMotion }) {
  return (
    <span aria-hidden="true" data-motion-preview={motion}>
      <span data-motion-preview-picture="">
        <span />
        <span />
        <span />
      </span>
      <span data-motion-preview-mark="" />
    </span>
  );
}
