import { type CommandResult, parseEngineCommand } from '../../shared/engine/commands';
import { type ShowEngine } from '../engine/show-engine';

/**
 * Validates and runs one engine command that arrived over IPC.
 * `allowed` says whether the sending page may control the show.
 */
export function runEngineCommand(engine: ShowEngine, raw: unknown, allowed: boolean): CommandResult {
  if (!allowed)
    return { ok: false, error: 'forbidden', message: 'Only the operator window can control the show' };
  const parsed = parseEngineCommand(raw);
  if (!parsed.ok) return { ok: false, error: 'invalid-command', message: parsed.message };
  return engine.dispatch(parsed.command);
}
