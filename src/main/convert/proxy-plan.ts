import type { MediaInfo } from './plan';
export interface ProxyComputer {
  logicalCores: number;
  softwareVideo: boolean;
}
export interface ProxyPlan {
  width: number;
  height: number;
  target: 'mp4' | 'webm-alpha';
}
export function proxyPlan(_info: MediaInfo, _computer: ProxyComputer): ProxyPlan | null {
  return null;
}
export function proxyArgs(
  _source: string,
  _dest: string,
  _info: MediaInfo,
  _computer: ProxyComputer,
): string[] {
  throw new Error('Proxy preparation is not implemented.');
}
