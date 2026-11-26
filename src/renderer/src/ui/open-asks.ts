/** A section's asks to unfold it, each a number one higher than the last (a chat popup's click: useChatOpen). */
export interface OpenAsks {
  /** Whether `asked` is an ask to act on now; it is taken. */
  take(asked: number): boolean;
}

/** Red: today's rule in Panel.tsx, whenever any ask was ever made. */
export function openAsks(atMount: number): OpenAsks {
  void atMount;
  return { take: (asked) => asked !== 0 };
}
