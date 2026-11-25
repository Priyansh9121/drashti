// Red: not built yet (QA23-CHAT-1).
export const BUZZ_MS = [120, 80, 120] as const;
export type AlertWay = 'buzz' | 'sound' | 'none';
export interface AlertPlace {
  target: EventTarget;
  vibrate: ((pattern: number[]) => boolean) | undefined;
  touchPoints: number;
  Sound: (new () => AudioContext) | undefined;
}
export function makeAlerts(_place: AlertPlace): { arm(): void; alert(): AlertWay } {
  return { arm: () => undefined, alert: () => 'none' };
}
export const armAlerts = (): void => undefined;
export const alertNewMessage = (): AlertWay => 'none';
