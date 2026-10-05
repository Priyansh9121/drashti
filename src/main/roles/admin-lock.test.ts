import { describe, expect, it } from 'vitest';
import { allChannels, IPC } from '../../shared/ipc';
import { ADMIN_CHANNELS, ADMIN_REFUSAL, isAdminChannel } from '../../shared/roles';
import { lockAdminChannels, lockChannels, refusalFor, refusedNow } from '../ipc/handle';
import { adminRefusals } from './admin-lock';

/* Which requests only an admin may make (with roles on), and how the main process refuses them. */

describe('the admin channels', () => {
  it('are real channels, each answering a refusal in its own shape', () => {
    for (const c of ADMIN_CHANNELS) expect(allChannels()).toContain(c);
    const answers = adminRefusals(() => ({ chosen: null, devices: [], state: 'default', checked: true }));
    for (const c of ADMIN_CHANNELS) expect(answers.has(c), c).toBe(true);
    expect(answers.get(IPC.screens.createGroup)?.()).toEqual({ ok: false, message: ADMIN_REFUSAL });
    // A file dialog asked for by an operator picks nothing; the sound output answers as it is.
    expect(answers.get(IPC.library.pickImportPaths)?.()).toEqual([]);
    expect(answers.get(IPC.audio.setOutput)?.()).toMatchObject({ state: 'default' });
  });

  it('leave running the show, playlists, words, slides and macros to the operator', () => {
    for (const c of [
      IPC.engine.command,
      IPC.macros.run,
      IPC.playlists.addItems,
      IPC.playlists.create,
      IPC.library.saveWords,
      IPC.library.saveSlides,
      IPC.props.save,
      IPC.messages.create,
      IPC.timers.create,
      IPC.announcements.approve,
      IPC.stream.goLive,
      IPC.stream.end,
      IPC.stream.startRecording,
      IPC.arti.putUp,
      IPC.nodes.identify,
      IPC.roles.unlock,
    ])
      expect(isAdminChannel(c), c).toBe(false);
  });

  it('are refused while admin is locked, after Simple Mode’s own refusals; each that goes through is heard', () => {
    let simple = false;
    let locked = true;
    let touched = 0;
    lockChannels(() => simple, new Map([[IPC.screens.createGroup, () => 'simple']]));
    lockAdminChannels(
      () => locked,
      adminRefusals(() => ({ chosen: null, devices: [], state: 'default', checked: true })),
      () => {
        touched++;
      },
    );
    expect(refusedNow(IPC.screens.createGroup)).toBe(true);
    expect(refusalFor(IPC.screens.createGroup)?.()).toEqual({ ok: false, message: ADMIN_REFUSAL });
    expect(refusedNow(IPC.playlists.create)).toBe(false);
    simple = true;
    expect(refusalFor(IPC.screens.createGroup)?.()).toBe('simple');
    simple = false;
    locked = false;
    expect(refusedNow(IPC.screens.createGroup)).toBe(false);
    expect(touched).toBe(0);
  });
});
