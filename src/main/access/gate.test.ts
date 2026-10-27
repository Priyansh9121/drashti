import { afterEach, describe, expect, it } from 'vitest';
import { accessState, isLetIn, isOwner, onAccessChange, setAccessState, type AccessState } from './gate';

const at = (phase: AccessState['phase'], owner = false): AccessState => ({
  phase,
  gmail: 'placeholder.user@example.com',
  owner,
  reason: null,
  stopsAt: null,
});

describe('whether this computer is let in (Session 54)', () => {
  afterEach(() =>
    setAccessState({ phase: 'checking', gmail: null, owner: false, reason: null, stopsAt: null }),
  );

  it('starts not let in, before the list has answered', () => {
    expect(accessState().phase).toBe('checking');
    expect(isLetIn()).toBe(false);
    expect(isOwner()).toBe(false);
  });

  it('is let in while in, and through the countdown with no answer, and never locked or stopped', () => {
    const letIn = (['checking', 'locked', 'in', 'warning', 'stopped'] as const).map((phase) => {
      setAccessState(at(phase));
      return isLetIn();
    });
    expect(letIn).toEqual([false, false, true, true, false]);
  });

  it('is the owner’s only while let in', () => {
    setAccessState(at('in', true));
    expect(isOwner()).toBe(true);
    setAccessState(at('stopped', true));
    expect(isOwner()).toBe(false);
  });

  it('tells every listener at once, until it stops listening', () => {
    const heard: string[] = [];
    const stop = onAccessChange((state) => heard.push(state.phase));
    setAccessState(at('in'));
    setAccessState(at('stopped'));
    stop();
    setAccessState(at('in'));
    expect(heard).toEqual(['in', 'stopped']);
  });
});
