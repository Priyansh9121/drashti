import { constants, getPriority, setPriority } from 'node:os';
const port = process.parentPort;
let lowPriority = false;
try {
  setPriority(process.pid, constants.priority.PRIORITY_LOW);
  lowPriority = getPriority() === constants.priority.PRIORITY_LOW;
} catch {
  /* Do not start costly work at normal priority. */
}
port.postMessage({ type: 'ready', lowPriority });
if (!lowPriority) process.exit(0);
process.env['OMP_NUM_THREADS'] = '1';
process.env['OMP_WAIT_POLICY'] = 'PASSIVE';
process.env['VECLIB_MAXIMUM_THREADS'] = '1';
let busyUntil = 0;
let closing = false;
let tail: Promise<void> = Promise.resolve();
const idle = async () => {
  while (!closing && Date.now() < busyUntil) await new Promise<void>((resolve) => setTimeout(resolve, 25));
  if (closing) throw new Error('CANCELLED');
};
// Heavy imports happen only after this child has actually reached low priority.
const modules = Promise.all([import('./protocol'), import('./worker-jobs')]);
port.on('message', ({ data }: { data: unknown }) => {
  if (data && typeof data === 'object' && 'type' in data) {
    const control = data as { type: unknown; until?: unknown };
    if (control.type === 'busy' && typeof control.until === 'number') {
      busyUntil = Math.min(Date.now() + 2000, control.until);
      return;
    }
    if (control.type === 'stop') {
      closing = true;
      void modules.then(([, jobs]) => jobs.closeJobs()).finally(() => process.exit(0));
      return;
    }
  }
  tail = tail
    .then(async () => {
      const [protocol, jobs] = await modules;
      const parsed = protocol.workerJobSchema.safeParse(data);
      if (!parsed.success) return;
      const job = parsed.data;
      try {
        await idle();
        const value = await jobs.runJob(
          job,
          (hints) => port.postMessage({ type: 'progress', id: job.id, hints }),
          idle,
        );
        if (!closing) port.postMessage({ type: 'done', id: job.id, value });
      } catch {
        if (!closing) port.postMessage({ type: 'error', id: job.id });
      }
    })
    .catch(() => undefined);
});
