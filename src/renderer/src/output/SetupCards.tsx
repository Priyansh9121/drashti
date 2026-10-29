/*
 * What the setup wizard puts on the outputs: a display's number while the operator works out which output feeds
 * which screens (Identify, only when pressed). There is no test slide any more (Session 55): a screen that has just
 * started shows what is up, or what shows while nothing is (render/NothingUp.tsx).
 */

/** A display's number and name, across the whole display. */
export function DisplayNumber({ number, label }: { number: string; label: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 border-[1.5vmin] border-accent bg-black"
      data-testid="display-number"
      data-number={number}
    >
      <div className="text-[30vmin] leading-none font-bold text-white">{number}</div>
      <div className="text-[5vmin] text-muted">{label}</div>
    </div>
  );
}
