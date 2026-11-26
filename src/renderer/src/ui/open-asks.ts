/**
 * A section's asks to unfold it (alpha.24: a chat popup's click opens Chat; the review's MUST 3), each a number one
 * higher than the last (useChatOpen). A section takes only an ask made after it mounted, and each only once: mounted
 * again later (Pro Mode, Simple Mode and Pro Mode again, or once the practice show ends), it finds the old asks
 * standing and stays as the operator left it, folded or open, with nothing scrolled (LIVE_SECTION's rule).
 */
export interface OpenAsks {
  /** Whether `asked` is an ask made since this section mounted, not yet taken; it is taken. */
  take(asked: number): boolean;
}

/** A section's asks, as they stood when it mounted. */
export function openAsks(atMount: number): OpenAsks {
  let seen = atMount;
  return {
    take(asked) {
      if (asked <= seen) return false;
      seen = asked;
      return true;
    },
  };
}
