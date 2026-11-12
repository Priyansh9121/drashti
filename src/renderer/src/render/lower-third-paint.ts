import type { Pose } from '../../../shared/lower-third-animations';

type PoseStyle = Pick<
  CSSStyleDeclaration,
  'opacity' | 'transform' | 'clipPath' | 'transformOrigin' | 'filter'
>;

/** Paint a lower third's animated CSS properties. */
export function paintLowerThirdPose(style: PoseStyle, pose: Pose): void {
  style.opacity = pose.opacity === 1 ? '' : String(pose.opacity);
  style.transform = pose.transform;
  style.clipPath = pose.clip;
  style.transformOrigin = pose.origin;
  style.filter = pose.filter ?? '';
}
