/*
 * A read that Drashti's "changed" asks for again and again while one is on its way (Session 54: a run of changes,
 * from a phone or the operator window, sends a burst of them): never two at once, and one more once it is in, so
 * the last change is always read and a burst costs a phone two requests, never one each. Drashti limits a device's
 * requests, and a read refused would leave a list out of date. Awaiting it waits for that last read.
 */
export function oneAtATime(read: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  // Asked for meanwhile (set by a call while the read was awaited).
  const askedAgain = () => again;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    const run = async () => {
      try {
        do {
          again = false;
          await read();
        } while (askedAgain());
      } finally {
        running = null;
      }
    };
    running = run();
    return running;
  };
}
