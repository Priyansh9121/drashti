import type { Pose } from '../../../shared/lower-third-animations';

type PoseStyle = Pick<
  CSSStyleDeclaration,
  'opacity' | 'transform' | 'clipPath' | 'transformOrigin' | 'filter'
>;

/** Paint a lower third's animated CSS properties. */
export function paintLowerThirdPose(style: PoseStyle, pose: Pose): void {
  const opacity = pose.opacity === 1 ? '' : String(pose.opacity);
  // Keep hidden letters in layout without a blur surface. Their first visible frame gets its full pose.
  const visible = pose.opacity > 0;
  const transform = visible ? pose.transform : '';
  const clipPath = visible ? pose.clip : '';
  const origin = visible ? pose.origin : '';
  const filter = visible ? (pose.filter ?? '') : '';
  if (style.opacity !== opacity) style.opacity = opacity;
  if (style.transform !== transform) style.transform = transform;
  if (style.clipPath !== clipPath) style.clipPath = clipPath;
  if (style.transformOrigin !== origin) style.transformOrigin = origin;
  if (style.filter !== filter) style.filter = filter;
}
