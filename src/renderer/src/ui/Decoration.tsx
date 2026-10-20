import type { ReactNode } from 'react';

/*
 * The appearance's band (Session 42): a thin strip of flat colours under the header, the appearance's sign. Its
 * five blocks take their colours and their shares of the width from the appearance (app.css, [data-band]); an
 * appearance with no band (Black, White) makes it 0 px tall, so nothing is drawn or moved. Decoration only: no
 * words on it, hidden from screen readers, and gone in forced colours.
 */
export function Band() {
  return (
    <div aria-hidden="true" data-band="" data-testid="band">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * LIVE, ON AIR and the network, in the header on a panel of their own (Session 42): the states are always read on
 * the appearance's own surfaces, never on the header's colour. In Black and White the panel is the header's own
 * colour, and it sits where its parts always sat (its padding is taken back by its margins).
 */
export function HeaderStates({ children }: { children: ReactNode }) {
  return (
    <div
      data-header-states=""
      data-testid="header-states"
      className="-mx-2 flex min-h-8 min-w-0 flex-1 items-center gap-4 rounded-md bg-panel px-2 text-fg"
    >
      {children}
    </div>
  );
}
