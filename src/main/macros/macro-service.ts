import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { EngineState, PropItem } from '../../shared/engine/state';
import type { Macro, MacroAction, MacroResult, MacroRunResult } from '../../shared/macros';
import { checkActions, macroInputSchema } from '../../shared/macros';
import type { MessageTemplate } from '../../shared/messages';
import { fillMessage, messageItemId } from '../../shared/messages';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { idSchema } from '../../shared/model-schema';
import type { MacroRepo } from '../db/macros';

/*
 * Macros (shared/macros.ts) as Drashti saves and runs them. Saving checks
 * every action; running checks them again (what is stored may have been
 * written another way), looks up what each names (the prop, the message
 * template, the file, the logo) and hands the engine the commands to run as
 * one change. Simple Mode runs no macros, from any trigger.
 */

export interface MacroServiceDeps {
  repo: MacroRepo;
  engine: {
    state(): EngineState;
    runMacro(commands: readonly EngineCommand[]): CommandResult;
  };
  reads: {
    prop(id: string): PropItem | null;
    template(id: string): MessageTemplate | null;
    media(id: string): { kind: 'image' | 'video' | 'audio'; name: string } | null;
    /** The prop marked as the logo, or null. */
    logo(): PropItem | null;
  };
  simple(): boolean;
  changed(macros: Macro[]): void;
  log(message: string): void;
}

export class MacroService {
  constructor(private readonly deps: MacroServiceDeps) {}

  list(): Macro[] {
    return this.deps.repo.asMacros(checkActions);
  }

  private done(id: string): MacroResult {
    const macros = this.list();
    this.deps.changed(macros);
    return { ok: true, macros, id };
  }

  save(rawId: unknown, raw: unknown): MacroResult {
    const id = idSchema.nullable().safeParse(rawId ?? null);
    const input = macroInputSchema.safeParse(raw);
    if (!id.success) return { ok: false, message: 'That macro no longer exists.' };
    if (!input.success)
      return { ok: false, message: 'A macro needs a name, a colour, and up to 30 actions.' };
    const checked = checkActions(input.data.actions);
    if (!checked.ok) return checked;
    const { name, color } = input.data;
    if (id.data === null) {
      const made = this.deps.repo.create(name, color, checked.actions);
      this.deps.log(`Macros: made one with ${checked.actions.length} action(s)`);
      return this.done(made);
    }
    if (!this.deps.repo.save(id.data, name, color, checked.actions))
      return { ok: false, message: 'That macro no longer exists.' };
    return this.done(id.data);
  }

  remove(rawId: unknown): MacroResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !this.deps.repo.remove(id.data))
      return { ok: false, message: 'That macro no longer exists.' };
    this.deps.log('Macros: removed one');
    return this.done(id.data);
  }

  /** The engine commands a macro runs, checked again now; or why it cannot run. */
  commands(
    macroId: string,
  ): { ok: true; commands: EngineCommand[]; name: string } | { ok: false; message: string } {
    if (this.deps.simple()) return { ok: false, message: SIMPLE_MODE_REFUSAL };
    const stored = this.deps.repo.get(macroId);
    if (!stored) return { ok: false, message: 'That macro no longer exists.' };
    const checked = checkActions(stored.actions);
    if (!checked.ok) return checked;
    const commands: EngineCommand[] = [];
    for (const action of checked.actions) {
      const made = this.command(action);
      if (!made.ok) return { ok: false, message: `“${stored.name}”: ${made.message}` };
      if (made.command) commands.push(made.command);
    }
    return { ok: true, commands, name: stored.name };
  }

  /** Run a macro now: from the Macros panel, the remote, the API or MIDI. */
  run(rawId: unknown, who = 'the operator window'): MacroRunResult {
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, message: 'That macro no longer exists.' };
    const got = this.commands(id.data);
    if (!got.ok) return got;
    const result = this.deps.engine.runMacro(got.commands);
    if (!result.ok) return { ok: false, message: result.message };
    this.deps.log(`Macros: ${who} ran one (${got.commands.length} command(s))`);
    return { ok: true, rev: result.rev, changed: result.changed };
  }

  private command(
    a: MacroAction,
  ): { ok: true; command: EngineCommand | null } | { ok: false; message: string } {
    const ok = (command: EngineCommand | null) => ({ ok: true as const, command });
    const state = this.deps.engine.state();
    switch (a.kind) {
      case 'look':
        return ok({ type: 'setLook', lookId: a.lookId });
      case 'clearLayer':
        return ok({ type: 'clearLayer', layer: a.layer });
      case 'clearAll':
        return ok({ type: 'clearAll' });
      case 'showProp': {
        const prop = this.deps.reads.prop(a.propId);
        return prop ? ok({ type: 'showProp', prop }) : { ok: false, message: 'its prop is no longer there.' };
      }
      case 'hideProp':
        return ok({ type: 'hideProp', propId: a.propId });
      case 'showMessage': {
        const template = this.deps.reads.template(a.templateId);
        if (!template) return { ok: false, message: 'its message is no longer there.' };
        const filled = fillMessage(
          template,
          a.values,
          (timerId) => state.timers.find((t) => t.id === timerId)?.name ?? '',
        );
        return filled.message
          ? ok({ type: 'showMessage', message: filled.message })
          : { ok: false, message: `its message needs ${filled.missing.map((m) => `{${m}}`).join(', ')}.` };
      }
      case 'hideMessage':
        return ok({ type: 'hideMessage', messageId: messageItemId(a.templateId) });
      case 'timer':
        return ok({
          type: a.how === 'start' ? 'startTimer' : a.how === 'pause' ? 'pauseTimer' : 'resetTimer',
          timerId: a.timerId,
        });
      case 'playSound': {
        const media = this.deps.reads.media(a.mediaId);
        if (media?.kind !== 'audio') return { ok: false, message: 'its sound is no longer in the library.' };
        return ok({
          type: 'playAudio',
          audio: { id: a.mediaId, title: media.name, mediaId: a.mediaId, volume: a.volume, loop: a.loop },
        });
      }
      case 'background': {
        const media = this.deps.reads.media(a.mediaId);
        if (media?.kind !== 'image' && media?.kind !== 'video')
          return { ok: false, message: 'its background is no longer in the library.' };
        return ok({
          type: 'setBackground',
          background: { kind: 'media', mediaId: a.mediaId, media: media.kind, fit: a.fit, loop: a.loop },
        });
      }
      case 'backgroundColor':
        return ok({ type: 'setBackground', background: { kind: 'color', color: a.color } });
      case 'blackout':
        return ok(
          a.to === 'toggle' ? { type: 'toggleBlackout' } : { type: 'setBlackout', on: a.to === 'on' },
        );
      case 'logo': {
        const on = a.to === 'toggle' ? state.logo === null : a.to === 'on';
        if (!on) return ok({ type: 'hideLogo' });
        const logo = this.deps.reads.logo();
        return logo
          ? ok({ type: 'showLogo', prop: logo })
          : { ok: false, message: 'no prop is marked as the logo.' };
      }
      case 'stageMessage':
        return ok(
          a.text === null ? { type: 'clearStageMessage' } : { type: 'setStageMessage', text: a.text },
        );
      case 'playItem':
        return ok({ type: 'playItem', playlistId: a.playlistId, itemId: a.itemId });
    }
  }
}
