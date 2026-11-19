import { engineCommandSchema, type EngineCommand } from '../../shared/engine/commands';
import { LAYER_NAMES } from '../../shared/engine/state';
import { idSchema } from '../../shared/model-schema';
import type { OscArgument, OscMessage } from './reader';

export type OscAction =
  | { op: 'command'; args: EngineCommand }
  | { op: 'message.show'; args: { templateId: string; values: Record<string, string> } }
  | { op: 'message.hide'; args: { templateId: string } };

const SIMPLE: Readonly<Record<string, string>> = {
  next: 'next',
  back: 'back',
  previous: 'previous',
  'next-item': 'nextItem',
  'previous-item': 'previousItem',
  'clear/all': 'clearAll',
  'put-back': 'putBack',
  'timers/hide': 'hideAudienceTimer',
  'stage-message/clear': 'clearStageMessage',
};
const TIMERS: Readonly<Record<string, string>> = {
  start: 'startTimer',
  pause: 'pauseTimer',
  reset: 'resetTimer',
  show: 'showAudienceTimer',
};
const text = (arg: OscArgument | undefined): string | undefined =>
  arg?.type === 's' && typeof arg.value === 'string' ? arg.value : undefined;
const boolean = (arg: OscArgument | undefined): boolean | undefined => {
  if ((arg?.type === 'T' || arg?.type === 'F') && typeof arg.value === 'boolean') return arg.value;
  if ((arg?.type === 'i' || arg?.type === 'f') && (arg.value === 0 || arg.value === 1))
    return arg.value === 1;
  return undefined;
};
const command = (raw: unknown): OscAction | null => {
  const parsed = engineCommandSchema.safeParse(raw);
  return parsed.success ? { op: 'command', args: parsed.data } : null;
};

/** A closed list of show actions; no raw command or pattern matching. */
export function mapOsc(message: OscMessage): OscAction | null {
  if (!message.address.startsWith('/drashti/')) return null;
  const address = message.address.slice('/drashti/'.length);
  const args = message.arguments;
  const simple = Object.hasOwn(SIMPLE, address) ? SIMPLE[address] : undefined;
  if (simple) return args.length === 0 ? command({ type: simple }) : null;
  if (address.startsWith('clear/')) {
    const layer = address.slice('clear/'.length);
    return args.length === 0 && (LAYER_NAMES as readonly string[]).includes(layer)
      ? command({ type: 'clearLayer', layer })
      : null;
  }
  if (address === 'slide') {
    if (args.length < 2 || args.length > 3 || args[1]?.type !== 'i') return null;
    return command({
      type: 'goLive',
      presentationId: text(args[0]),
      slideIndex: args[1].value,
      ...(args.length === 3 ? { arrangementId: text(args[2]) ?? '' } : {}),
    });
  }
  if (address === 'item') {
    return args.length === 2
      ? command({ type: 'playItem', playlistId: text(args[0]), itemId: text(args[1]) })
      : null;
  }
  if (address === 'blackout' || address === 'wallpaper') {
    const suffix = address === 'blackout' ? 'Blackout' : 'Wallpaper';
    if (args.length === 0) return command({ type: 'toggle' + suffix });
    const on = boolean(args[0]);
    return args.length === 1 && on !== undefined ? command({ type: 'set' + suffix, on }) : null;
  }
  if (address.startsWith('timers/')) {
    const action = address.slice('timers/'.length);
    const type = Object.hasOwn(TIMERS, action) ? TIMERS[action] : undefined;
    return type && args.length === 1 ? command({ type, timerId: text(args[0]) }) : null;
  }
  if (address === 'messages/show' || address === 'messages/hide') {
    const id = idSchema.safeParse(text(args[0]));
    if (!id.success) return null;
    if (address === 'messages/hide')
      return args.length === 1 ? { op: 'message.hide', args: { templateId: id.data } } : null;
    if (args.length % 2 !== 1) return null;
    const values: Record<string, string> = {};
    for (let n = 1; n < args.length; n += 2) {
      const key = text(args[n]);
      const value = text(args[n + 1]);
      if (
        !key ||
        key.length > 60 ||
        value === undefined ||
        value.length > 200 ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        Object.hasOwn(values, key)
      )
        return null;
      values[key] = value;
    }
    return { op: 'message.show', args: { templateId: id.data, values } };
  }
  if (address === 'stage-message') {
    if (args.length < 1 || args.length > 3) return null;
    const flash = args.length === 3 ? boolean(args[2]) : undefined;
    if (args.length === 3 && flash === undefined) return null;
    return command({
      type: 'setStageMessage',
      text: text(args[0]),
      ...(args.length >= 2 ? { size: text(args[1]) ?? '' } : {}),
      ...(flash !== undefined ? { flash } : {}),
    });
  }
  return null;
}
