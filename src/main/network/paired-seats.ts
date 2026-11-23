/** Admission accounting shared by the two local device servers. */
export interface SeatLimits {
  total: number;
  perAddress: number;
  open: number;
  openPerAddress: number;
  replaceWaitingAtAddressLimit?: boolean;
}

interface Seat<T> {
  key: T;
  address: string;
  protected: number;
  close(): void;
}

/** A new connection may replace a waiting connection, never one that has proved its pairing. */
export class PairedSeats<T> {
  private readonly seats = new Map<T, Seat<T>>();

  constructor(
    private readonly limits: SeatLimits,
    private readonly busy: () => void,
  ) {}

  add(key: T, address: string, close: () => void): boolean {
    const all = [...this.seats.values()];
    const here = all.filter((s) => s.address === address);
    const waiting = all.filter((s) => s.protected === 0);
    const waitingHere = waiting.filter((s) => s.address === address);
    const addressFull = here.length >= this.limits.perAddress;
    if (
      addressFull &&
      this.limits.openPerAddress === this.limits.perAddress &&
      !this.limits.replaceWaitingAtAddressLimit
    ) {
      this.busy();
      return false;
    }
    const local = addressFull || waitingHere.length >= this.limits.openPerAddress;
    const full = all.length >= this.limits.total || waiting.length >= this.limits.open;
    if (local || full) {
      this.busy();
      if (this.limits.open === this.limits.total && all.length >= this.limits.total) return false;
      const old = (local ? waitingHere : waiting)[0];
      if (!old) return false;
      this.remove(old.key);
      old.close();
    }
    this.seats.set(key, { key, address, protected: 0, close });
    return true;
  }

  /** Hold a place after pairing is proved. Closing or revocation removes the place. */
  protect(key: T): () => void {
    const seat = this.seats.get(key);
    if (!seat) return () => undefined;
    seat.protected++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      seat.protected--;
      this.trimWaiting();
    };
  }

  private trimWaiting(): void {
    for (;;) {
      const waiting = [...this.seats.values()].filter((s) => s.protected === 0);
      const overAddress = waiting.find(
        (s) => waiting.filter((other) => other.address === s.address).length > this.limits.openPerAddress,
      );
      const old = overAddress ?? (waiting.length > this.limits.open ? waiting[0] : undefined);
      if (!old) return;
      this.remove(old.key);
      old.close();
    }
  }

  openFull(key: T): boolean {
    const seat = this.seats.get(key);
    if (!seat) return true;
    const waiting = [...this.seats.values()].filter((s) => s.protected === 0);
    return (
      waiting.length >= this.limits.open ||
      waiting.filter((s) => s.address === seat.address).length >= this.limits.openPerAddress
    );
  }

  remove(key: T): void {
    this.seats.delete(key);
  }

  closeWaiting(): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.protected !== 0) continue;
      this.remove(seat.key);
      seat.close();
    }
  }

  clear(): void {
    const seats = [...this.seats.values()];
    this.seats.clear();
    for (const seat of seats) seat.close();
  }
}

export function connectionSeats(total: number, perAddress: number): SeatLimits {
  return {
    total,
    perAddress,
    open: total - Math.floor(total / 4) * 3,
    openPerAddress: perAddress,
  };
}

export const PAIRED_SEATS_BUSY =
  'Drashti is busy. Paired devices keep their places. Ask the operator before pairing a new device.';
export const PAIRED_SEATS_NOTICE = 'Drashti is busy with new connections. Paired devices keep their places.';

/** The accepted TCP socket and HTTPS’s wrapper share these peer coordinates. */
export function socketSeat(socket: { remoteAddress?: string; remotePort?: number }): string {
  return `${socket.remoteAddress ?? ''}:${String(socket.remotePort ?? 0)}`;
}
