/**
 * A read that a window waits on before it shows anything (Session 38): it is always answered. The operator
 * window shows nothing until it knows the single-letter keys setting (Session 37), so a read of the library
 * that throws must never leave its request unanswered, or the window would stay blank. When `read` throws,
 * the answer is `fallback`, and `say` hears why: once, then again only if it was read in between.
 */
export function readOrDefault<T>(read: () => T, fallback: T, say: (error: unknown) => void): () => T {
  let failing = false;
  return () => {
    try {
      const value = read();
      failing = false;
      return value;
    } catch (error) {
      if (!failing) say(error);
      failing = true;
      return fallback;
    }
  };
}
