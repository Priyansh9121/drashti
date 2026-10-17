/*
 * The GPU process stopping (Sessions 31–36, ROB-5). Chromium starts another by itself, and the windows play
 * their failed videos again; a second stop within 10 minutes is told to the operator, once, as something
 * on this computer is wrong (a graphics driver, the GPU itself).
 */

/** Two stops this close together are told. */
export const GPU_STOPS_WITHIN_MS = 10 * 60_000;

/** What the operator is told. */
export const GPU_STOPPED_TWICE =
  'The screens’ graphics stopped twice in 10 minutes, and Drashti started them again each time. After the sabha, restart the computer; if it happens again, tell the admin (Help, then Save Diagnostics…).';

/** The GPU process's stops: `stopped` says whether this one is the second within GPU_STOPS_WITHIN_MS. */
export class GpuStops {
  private readonly stops: number[] = [];

  stopped(now: number): boolean {
    this.stops.push(now);
    while (this.stops.length > 0 && now - (this.stops[0] ?? now) > GPU_STOPS_WITHIN_MS) this.stops.shift();
    return this.stops.length === 2;
  }
}
