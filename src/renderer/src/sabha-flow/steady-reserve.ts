/* Sabha flow (alpha.23): the steady room for Now and Next up. Stub: measures once. */

export interface Measured {
  getBoundingClientRect(): { height: number };
}

export interface ReserveBox {
  querySelectorAll(selector: string): Iterable<Measured>;
}

export interface ReserveDeps {
  observe(targets: readonly unknown[], changed: () => void): () => void;
  fonts?: {
    addEventListener(type: 'loadingdone', listener: () => void): void;
    removeEventListener(type: 'loadingdone', listener: () => void): void;
  };
  marginTop(el: Measured): number;
}

export function watchReserve(
  box: ReserveBox,
  onReserve: (px: number) => void,
  deps: ReserveDeps,
): () => void {
  let now = 0;
  let next = 0;
  for (const el of box.querySelectorAll('[data-measure="now"]'))
    now = Math.max(now, el.getBoundingClientRect().height);
  for (const el of box.querySelectorAll('[data-measure="next"]'))
    next = Math.max(next, el.getBoundingClientRect().height + deps.marginTop(el));
  onReserve(Math.ceil(now + next));
  return () => undefined;
}
