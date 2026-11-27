import type { InterfaceMotion } from '../../../shared/appearance/appearances';

/** Decoration only: a small sample inside an interface-motion choice. */
export function MotionPreview({ motion }: { motion: InterfaceMotion }) {
  return <span aria-hidden="true" data-motion-preview={motion} />;
}
