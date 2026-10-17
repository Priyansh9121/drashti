/** The part of Electron's powerSaveBlocker the guard uses (easy to fake in tests). */
export interface PowerSaveApi {
  start(type: 'prevent-display-sleep'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/**
 * Screens never sleep or dim during a show: while at least one output is
 * showing, or the stream is on air or recording (Session 31: a stream with
 * no hall screen must not stop when the computer sleeps), hold one
 * 'prevent-display-sleep' blocker (it also keeps the screen saver away);
 * release it when neither is so.
 */
export class SleepGuard {
  private id: number | null = null;
  private outputs = 0;
  private streaming = false;

  constructor(
    private readonly api: PowerSaveApi,
    private readonly onChange: (held: boolean) => void = () => undefined,
  ) {}

  get held(): boolean {
    return this.id !== null && this.api.isStarted(this.id);
  }

  /** How many outputs are showing (a stopped one too: it is still on its display, tried again). */
  update(showingOutputs: number): void {
    this.outputs = showingOutputs;
    this.apply();
  }

  /** The stream is on air or recording. */
  setStreaming(on: boolean): void {
    this.streaming = on;
    this.apply();
  }

  private apply(): void {
    if (this.outputs > 0 || this.streaming) {
      if (this.held) return;
      this.id = this.api.start('prevent-display-sleep');
      this.onChange(true);
    } else {
      this.release();
    }
  }

  release(): void {
    if (this.id === null) return;
    if (this.api.isStarted(this.id)) this.api.stop(this.id);
    this.id = null;
    this.onChange(false);
  }
}
