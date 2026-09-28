/** The part of Electron's powerSaveBlocker the guard uses (easy to fake in tests). */
export interface PowerSaveApi {
  start(type: 'prevent-display-sleep'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/**
 * Screens never sleep or dim during a show: while at least one output is
 * showing, hold one 'prevent-display-sleep' blocker (it also keeps the
 * screen saver away); release it when none are showing.
 */
export class SleepGuard {
  private id: number | null = null;

  constructor(
    private readonly api: PowerSaveApi,
    private readonly onChange: (held: boolean) => void = () => undefined,
  ) {}

  get held(): boolean {
    return this.id !== null && this.api.isStarted(this.id);
  }

  update(showingOutputs: number): void {
    if (showingOutputs > 0) {
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
