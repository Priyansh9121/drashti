import { constants, setPriority } from 'node:os';
import { z } from 'zod';
import { normalizeTrustedChromiumPrint } from '../import/normalize-printed-pdf';

const requestSchema = z.object({
  id: z.uuid(),
  data: z.instanceof(Uint8Array).refine((bytes) => bytes.length > 8 && bytes.length <= 64 * 1024 * 1024),
  pages: z.array(z.object({
    ref: z.object({ num: z.number().int().positive(), gen: z.number().int().min(0).max(65535) }),
    view: z.array(z.number()).length(4),
    rotate: z.number().int(),
    target: z.object({ width: z.number().min(16).max(14400), height: z.number().min(16).max(14400) }),
  })).length(1),
}).strict();
const port = process.parentPort;
if (!port) throw new Error('PDF geometry requires its parent.');
try { setPriority(process.pid, constants.priority.PRIORITY_LOW); } catch { /* Owned, bounded process. */ }
let started = false;
port.on('message', ({ data }: { data: unknown }) => {
  if (started) return;
  started = true;
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) return;
  try {
    const result = normalizeTrustedChromiumPrint(parsed.data.data, {
      provenance: 'fresh-chromium-print', pages: parsed.data.pages,
    });
    port.postMessage({ id: parsed.data.id, ok: true, data: new Uint8Array(result.bytes) });
  } catch { port.postMessage({ id: parsed.data.id, ok: false }); }
  // The parent confirms actual exit before resolving or reusing the single slot.
});
