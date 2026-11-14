/*
 * The speed tests' clock (Session 58, h-flaky): how long this thread has worked, in ms. The speed tests time the main
 * process's own work against a budget (vitest.config.ts), and the wall clock also counts every moment a busy computer
 * gives to other programs or spends bringing back memory it had set aside: on the shared Mac, search's 15 ms median
 * read 18.7 to 45 ms and the library list 44 ms against 20, while the same queries take 0.1 to 9 ms of work. The
 * thread's own CPU time counts only its work. On a quiet computer the two agree (each query within 0.7 ms of the wall
 * clock), so every budget keeps its meaning: the operator waits as long as the work takes.
 *
 * Windows counts a thread's time only in whole clock ticks (15.6 ms), too coarse for work of a few milliseconds:
 * there it is the wall clock, as before (Windows runs the speed tests only on CI's own runners).
 */

/** This thread's working time so far, in ms: its CPU time (the wall clock on Windows). */
export function workNow(platform: NodeJS.Platform = process.platform): number {
  if (platform === 'win32') return performance.now();
  const used = process.threadCpuUsage();
  return (used.user + used.system) / 1000;
}
