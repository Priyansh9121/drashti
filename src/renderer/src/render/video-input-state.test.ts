import { describe, expect, it } from 'vitest';
import {
  findInputDevice,
  inputDeviceNames,
  reportOf,
  retryAfterMs,
  stopReasonOf,
  type SeenDevice,
} from './video-input-state';

/*
 * A video input as a page opens it (Session 50): found among this computer's devices by its name, never by
 * chance; how it stands when it has no live picture; when it is tried again by itself; what the page says of it.
 */

const camera = (label: string, deviceId = `id-${label}`): SeenDevice => ({
  kind: 'videoinput',
  deviceId,
  label,
});

describe('finding a video input by its name', () => {
  const devices: SeenDevice[] = [
    { kind: 'audioinput', deviceId: 'mic', label: 'fake_device_0' },
    camera('Placeholder camera'),
    camera('fake_device_0', 'the-fake'),
    camera('fake_device_0', 'a-second-of-the-same-name'),
  ];

  it('is the camera or capture input of exactly that name: never a microphone of the same name', () => {
    expect(findInputDevice(devices, 'fake_device_0')).toBe('the-fake');
    expect(findInputDevice(devices, 'Placeholder camera')).toBe('id-Placeholder camera');
  });

  it('is nothing when no input has the name, or the name is empty: never another camera', () => {
    expect(findInputDevice(devices, 'fake_device_1')).toBeNull();
    expect(findInputDevice(devices, 'Fake_Device_0')).toBeNull();
    expect(findInputDevice(devices, '')).toBeNull();
    // Unnamed (the page may not see names): nothing, not the first one.
    expect(findInputDevice([camera('', 'unnamed')], '')).toBeNull();
    expect(
      findInputDevice([{ kind: 'videoinput', deviceId: '', label: 'fake_device_0' }], 'fake_device_0'),
    ).toBeNull();
  });

  it('lists this computer’s inputs by name for Add a Video Input…, each once, as the computer orders them', () => {
    expect(inputDeviceNames(devices)).toEqual(['Placeholder camera', 'fake_device_0']);
    expect(inputDeviceNames([camera(''), { kind: 'audiooutput', deviceId: 'x', label: 'Speakers' }])).toEqual(
      [],
    );
  });
});

describe('a video input with no live picture', () => {
  const failure = (name: string) => Object.assign(new Error(name), { name });

  it('says why: refused, not there, or busy (taken by another app)', () => {
    expect(stopReasonOf(failure('NotAllowedError'))).toBe('refused');
    expect(stopReasonOf(failure('SecurityError'))).toBe('refused');
    expect(stopReasonOf(failure('NotFoundError'))).toBe('missing');
    expect(stopReasonOf(failure('OverconstrainedError'))).toBe('missing');
    expect(stopReasonOf(failure('NotReadableError'))).toBe('busy');
    expect(stopReasonOf(failure('AbortError'))).toBe('busy');
    expect(stopReasonOf('something else')).toBe('busy');
    expect(stopReasonOf(null)).toBe('busy');
  });

  it('is tried again by itself, a little later, unless it only paused (it plays again when its frames come back)', () => {
    for (const reason of ['missing', 'busy', 'ended'] as const) expect(retryAfterMs(reason)).toBe(3000);
    // Asking again and again while the computer refuses would only fill the log.
    expect(retryAfterMs('refused')).toBe(10_000);
    expect(retryAfterMs('muted')).toBeNull();
  });

  it('is said to the main process as stopped; live as playing; nothing while it opens or is not on this computer', () => {
    expect(reportOf('live')).toBe('playing');
    expect(reportOf('stopped')).toBe('stopped');
    expect(reportOf('opening')).toBeNull();
    expect(reportOf('absent')).toBeNull();
  });
});
