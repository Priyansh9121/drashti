import type { EngineCommand } from '../../shared/engine/commands';
import type { OscMessage } from './reader';

export type OscAction =
  | { op: 'command'; args: EngineCommand }
  | { op: 'message.show'; args: { templateId: string; values: Record<string, string> } }
  | { op: 'message.hide'; args: { templateId: string } };

/** A closed list of show actions; no raw command or pattern matching. */
export function mapOsc(_message: OscMessage): OscAction | null {
  return null;
}
