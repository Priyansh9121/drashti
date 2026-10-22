import { describe, expect, it } from 'vitest';
import {
  accessView,
  inputRowNote,
  mayOpenInputs,
  nameProblem,
  nextInputName,
  refusedWords,
  settingsLabel,
  stoppedInput,
  stoppedWords,
} from './words';

/* Add a Video Input…, Media's Video inputs and the stopped notice (Session 50): what they say and offer. */

const inputs = [
  { id: 'a', name: 'Input 1' },
  { id: 'b', name: 'Input 3' },
];

describe('naming a video input', () => {
  it('offers Input 1, or the first number not taken', () => {
    expect(nextInputName([])).toBe('Input 1');
    expect(nextInputName(inputs)).toBe('Input 2');
    expect(nextInputName([...inputs, { id: 'c', name: 'input 2' }])).toBe('Input 4');
  });

  it('wants a name, and one no other input has (its own is fine when changing it)', () => {
    expect(nameProblem('', inputs, null)).toBe('Give it a name, such as “Input 2”.');
    expect(nameProblem('   ', inputs, null)).toBe('Give it a name, such as “Input 2”.');
    expect(nameProblem(' input 1 ', inputs, null)).toBe('Another video input is called “Input 1”.');
    expect(nameProblem('Input 1', inputs, 'a')).toBeNull();
    expect(nameProblem('Placeholder input', inputs, null)).toBeNull();
  });
});

describe('asking for the camera', () => {
  it('says why first on a Mac that has not been asked, and lists the inputs once it may', () => {
    expect(accessView(null, 'darwin')).toBe('checking');
    expect(accessView('not-determined', 'darwin')).toBe('ask');
    expect(accessView('granted', 'darwin')).toBe('list');
    expect(accessView('granted', 'win32')).toBe('list');
    // Drashti cannot tell: it looks, and an input that cannot open says so.
    expect(accessView('unknown', 'linux')).toBe('list');
    expect(accessView('not-determined', 'win32')).toBe('list');
  });

  it('says plainly when the camera is refused, on a Mac and on Windows', () => {
    expect(accessView('denied', 'darwin')).toBe('refused');
    expect(accessView('restricted', 'darwin')).toBe('refused');
    expect(accessView('denied', 'win32')).toBe('refused');
    const mac = refusedWords('denied', 'darwin');
    expect(mac.title).toBe('Drashti may not use the camera');
    expect(mac.text).toContain('turn Drashti on under Camera');
    expect(refusedWords('restricted', 'darwin').text).toContain('administrator');
    const windows = refusedWords('denied', 'win32');
    expect(windows.title).toBe('Windows’ camera privacy setting is off');
    expect(windows.text).toContain('Let desktop apps access your camera');
    expect(settingsLabel('darwin')).toBe('Open System Settings');
    expect(settingsLabel('win32')).toBe('Open Settings');
  });

  it('opens no camera for a small picture before macOS has been asked (after Drashti said why)', () => {
    expect(mayOpenInputs('granted')).toBe(true);
    expect(mayOpenInputs('unknown')).toBe(true);
    for (const access of [null, 'not-determined', 'denied', 'restricted'] as const)
      expect(mayOpenInputs(access)).toBe(false);
  });
});

describe('the input that stopped', () => {
  const stopped = { stopped: { inputId: 'a', name: 'Input 1' }, access: 'granted' as const };

  it('is said while it is still the one up', () => {
    expect(stoppedInput(stopped, 'a')).toEqual({ inputId: 'a', name: 'Input 1' });
    expect(stoppedInput(stopped, 'b')).toBeNull();
    expect(stoppedInput(stopped, null)).toBeNull();
    expect(stoppedInput({ stopped: null, access: 'granted' }, 'a')).toBeNull();
  });

  it('says its last picture stays and it comes back by itself, or that the camera is refused and where to turn it on', () => {
    expect(stoppedWords('granted', 'darwin')).toBe(
      'The screens keep its last picture. Its cable may be out, or another app may be using it: it comes back by itself when the input returns.',
    );
    expect(stoppedWords('denied', 'darwin')).toContain('macOS no longer lets Drashti use the camera');
    expect(stoppedWords('denied', 'win32')).toContain('Windows’ camera privacy setting is off');
  });
});

describe('a row of Media’s Video inputs', () => {
  it('says it is a video input and how it sits, or why it has no picture now', () => {
    expect(inputRowNote(null, 'fit')).toBe('Video input · fitted inside');
    expect(inputRowNote({ state: 'live', reason: null }, 'fill')).toBe('Video input · filling the screen');
    expect(inputRowNote({ state: 'opening', reason: null }, 'fit')).toBe('Video input · fitted inside');
    expect(inputRowNote({ state: 'stopped', reason: 'missing' }, 'fit')).toBe('Video input · not connected');
    expect(inputRowNote({ state: 'stopped', reason: 'refused' }, 'fit')).toBe(
      'Video input · the camera is refused',
    );
    expect(inputRowNote({ state: 'stopped', reason: 'busy' }, 'fit')).toBe('Video input · no picture now');
    expect(inputRowNote({ state: 'stopped', reason: 'ended' }, 'fit')).toBe('Video input · no picture now');
  });
});
