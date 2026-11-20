import type { AudioDevice, AudioOutputState, AudioOutputStatus } from '../../shared/audio';
import { audioDeviceSchema, audioDevicesSchema, resolveOutput } from '../../shared/audio';

export interface AudioOutputDeps {
  /** The remembered choice (null: the system default). */
  load(): unknown;
  save(device: AudioDevice | null): void;
  /** Tell the audio player about a new choice. */
  chosen(device: AudioDevice | null): void;
  /** Tell the operator where sound plays now. */
  status(status: AudioOutputStatus): void;
  log(message: string): void;
}

/**
 * Which sound output Drashti plays on. The operator chooses it; it is
 * remembered across restarts; the audio player (which alone can see the
 * outputs) says which ones are connected and whether the choice is among them.
 */
export class AudioOutput {
  private chosenDevice: AudioDevice | null;
  private devices: AudioDevice[] = [];
  private state: AudioOutputState;
  private checked = false;
  /** The sound player given up on (x53): nothing is heard until it is tried again. */
  private playerStopped = false;

  constructor(private readonly deps: AudioOutputDeps) {
    const saved = audioDeviceSchema.nullable().safeParse(deps.load() ?? null);
    this.chosenDevice = saved.success ? saved.data : null;
    this.state = this.chosenDevice ? 'chosen' : 'default';
  }

  get status(): AudioOutputStatus {
    return {
      chosen: this.chosenDevice,
      devices: this.devices,
      state: this.state,
      checked: this.checked,
      ...(this.playerStopped ? { playerStopped: true as const } : {}),
    };
  }

  /** The sound player given up on (it kept failing), or tried again (x53): the operator is told. */
  setPlayerStopped(stopped: boolean): void {
    if (this.playerStopped === stopped) return;
    this.playerStopped = stopped;
    this.deps.log(
      stopped
        ? 'The sound player kept failing: given up on for now, and the operator told'
        : 'The sound player is tried again',
    );
    this.deps.status(this.status);
  }

  get chosen(): AudioDevice | null {
    return this.chosenDevice;
  }

  /** The operator's choice (validated here: it arrives over IPC). */
  choose(raw: unknown): AudioOutputStatus {
    const parsed = audioDeviceSchema.nullable().safeParse(raw ?? null);
    if (!parsed.success) return this.status;
    this.chosenDevice = parsed.data;
    this.deps.save(this.chosenDevice);
    // Until the audio player answers, assume it can use what was just picked from its own list.
    this.state = resolveOutput(this.chosenDevice, this.devices).state;
    this.deps.log(`Sound output: ${this.chosenDevice ? this.chosenDevice.label : 'the system default'}`);
    this.deps.chosen(this.chosenDevice);
    this.deps.status(this.status);
    return this.status;
  }

  /** What the audio player found. */
  report(rawDevices: unknown, rawState: unknown): void {
    const devices = audioDevicesSchema.safeParse(rawDevices);
    if (!devices.success || (rawState !== 'chosen' && rawState !== 'default' && rawState !== 'missing'))
      return;
    const changed = rawState !== this.state || !this.checked;
    this.devices = devices.data;
    this.state = rawState;
    this.checked = true;
    if (changed && rawState === 'missing') {
      this.deps.log(
        `Sound output "${this.chosenDevice?.label ?? ''}" is not connected; playing on the system default.`,
      );
    }
    this.deps.status(this.status);
  }
}
