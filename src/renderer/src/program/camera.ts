import type { CameraState, DeviceChoice, SoundState } from '../../../shared/stream';
import { reportInputs, useProgram } from './program-store';

/*
 * The stream's camera and sound input. Only this page may open them (its
 * window has a session of its own). A capture card that shows up as a
 * camera is chosen and used the same way.
 */

/** The device the operator chose, found again by its id, or else by its name. */
export function findDevice(
  choice: DeviceChoice | null,
  devices: readonly DeviceChoice[],
): DeviceChoice | null {
  if (!choice) return null;
  return devices.find((d) => d.id === choice.id) ?? devices.find((d) => d.label === choice.label) ?? null;
}

/** What a failed getUserMedia means for the operator. */
export function failureState(error: unknown): 'blocked' | 'failed' | 'missing' {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
}

/** Every camera and sound input the page can see (with names once it is allowed to use them). */
export async function listDevices(): Promise<void> {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    all
      .filter(
        (d) =>
          d.kind === kind && d.deviceId !== '' && d.deviceId !== 'default' && d.deviceId !== 'communications',
      )
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  useProgram.setState({
    cameras: pick('videoinput', 'Camera'),
    microphones: pick('audioinput', 'Sound input'),
  });
  reportInputs();
}

let cameraFor: string | null = null;
let starting: Promise<void> | null = null;

function stopCamera(): void {
  const stream = useProgram.getState().cameraStream;
  for (const t of stream?.getTracks() ?? []) t.stop();
  useProgram.setState({ cameraStream: null });
}

/** Open the chosen camera (or close it), when the choice or the devices change. */
export async function applyCameraChoice(
  choice: DeviceChoice | null,
  size: { width: number; height: number },
): Promise<void> {
  if (starting) await starting;
  const device = findDevice(choice, useProgram.getState().cameras);
  const key = choice ? `${device?.id ?? 'missing'}@${size.width}x${size.height}` : null;
  const current = useProgram.getState();
  if (key === cameraFor && (current.camera === 'on' || current.camera === 'none')) return;
  cameraFor = key;
  stopCamera();
  if (!choice) {
    useProgram.setState({ camera: 'none' });
    reportInputs();
    return;
  }
  if (!device) {
    // Nothing named that is connected: it may come back (devicechange tries again).
    useProgram.setState({ camera: 'missing' });
    reportInputs();
    return;
  }
  useProgram.setState({ camera: 'starting' });
  reportInputs();
  starting = (async () => {
    let state: CameraState;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: device.id },
          width: { ideal: size.width },
          height: { ideal: size.height },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      for (const t of stream.getVideoTracks())
        t.addEventListener('ended', () => {
          // Unplugged: say so, and try again when devices change.
          cameraFor = null;
          stopCamera();
          useProgram.setState({ camera: 'missing' });
          reportInputs();
        });
      useProgram.setState({ cameraStream: stream });
      state = 'on';
    } catch (error) {
      state = failureState(error);
    }
    useProgram.setState({ camera: state });
    reportInputs();
  })();
  await starting;
  starting = null;
  // The names come once the page may use a camera.
  await listDevices();
}

/** The sound input's state, kept beside the camera's for the operator. */
export function setSoundState(sound: SoundState): void {
  useProgram.setState({ sound });
  reportInputs();
}
