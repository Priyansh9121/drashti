/**
 * The browser task scheduler, for a cue's Go check on every page and LIVE's other future starts (render/playback.ts);
 * any other later start (a deck's clip) keeps its ordinary timer.
 */
interface GoScheduler {
  postTask(
    run: () => void,
    options: { delay: number; priority: 'user-blocking'; signal: AbortSignal },
  ): Promise<unknown>;
}

/** Ask for a clock check, never decide playback from a timer or task’s own clock. */
export function scheduleGoCheck(run: () => void, delay: number, priority: boolean): () => void {
  const scheduler = (globalThis as unknown as { scheduler?: GoScheduler }).scheduler;
  if (priority && scheduler) {
    const controller = new AbortController();
    void scheduler
      .postTask(run, { delay, priority: 'user-blocking', signal: controller.signal })
      .catch(() => undefined);
    return () => controller.abort();
  }
  // eslint-disable-next-line no-restricted-syntax -- asks playback to check the shared clock at its scheduled start
  const timer = setTimeout(run, delay);
  return () => clearTimeout(timer);
}
