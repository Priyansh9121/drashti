import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { EngineSnapshotMessage } from '../../shared/engine/protocol';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import type { NodeScreen } from '../../shared/nodes';
import { nodeScreenListSchema } from '../../shared/nodes-schema';
import { readState, readStateTwice, setAside } from '../state-file';
import type { PinnedMain } from './link-client';

/*
 * What a node keeps in its data folder (Session 13):
 * - node.json: the Main it follows (its pinned certificate and where to find
 *   it), its own token from pairing, and the screens it last showed;
 * - node-show.json: the last show state it had, so a node that restarts while
 *   Main cannot be reached shows the last picture again.
 * Both are written whole to a new file and moved into place, so a power cut
 * never leaves half of one. The token is the node's own key to Main: the file
 * is readable by this computer's user only.
 */

export interface NodeFile {
  main: PinnedMain;
  token: string;
  node: { id: string; name: string };
  screens: NodeScreen[];
  pairedAt: string;
}

const pinnedSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200),
  certPem: z.string().min(1).max(8000),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  addresses: z.array(z.string().min(1).max(255)).min(1).max(8),
  port: z.number().int().min(1).max(65535),
});

const fileSchema = z.object({
  main: pinnedSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/u),
  node: z.object({ id: z.string().min(1).max(128), name: z.string().max(200) }),
  screens: nodeScreenListSchema,
  pairedAt: z.string().max(40),
});

const parseNodeFile = (raw: unknown): NodeFile | null => {
  const parsed = fileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

function writeWhole(file: string, text: string): void {
  const temp = `${file}.writing`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, file);
}

export class NodeStore {
  readonly file: string;
  readonly showFile: string;

  constructor(dir: string) {
    this.file = join(dir, 'node.json');
    this.showFile = join(dir, 'node-show.json');
  }

  read(): NodeFile | null {
    const read = readState(this.file, parseNodeFile);
    return read.status === 'ok' ? read.value : null;
  }

  /**
   * The pairing at the start (Session 23): one that is there but cannot be read is not taken for
   * none (pairing again would have written over it). It is read once more after a moment, then set
   * aside with the date, and the note says so: the node starts unpaired, and is paired again.
   */
  load(o: { log: (message: string) => void; now?: Date; retryMs?: number }): {
    paired: NodeFile | null;
    note: string | null;
  } {
    const read = readStateTwice(this.file, parseNodeFile, o.retryMs);
    if (read.status === 'ok') return { paired: read.value, note: null };
    if (read.status === 'missing') return { paired: null, note: null };
    const moved = setAside(this.file, o.now);
    const kept = moved ? `kept as “${basename(moved)}”` : 'left where it is';
    o.log(`Node: node.json could not be read (${read.reason}); ${kept}. Starting unpaired`);
    return {
      paired: null,
      note: `This node's pairing with Main could not be read, so it starts unpaired. The file was ${kept} in Drashti's data folder. Pair it with Main again: a new code from Main's Screens, Nodes.`,
    };
  }

  write(state: NodeFile): void {
    writeWhole(this.file, JSON.stringify(state, null, 2));
  }

  /** Unpaired: the Main, the token, the screens and the last picture are forgotten. */
  forget(): void {
    rmSync(this.file, { force: true });
    rmSync(this.showFile, { force: true });
  }

  readShow(): { snapshot: EngineSnapshotMessage; offsetMs: number } | null {
    try {
      const raw = JSON.parse(readFileSync(this.showFile, 'utf8')) as {
        snapshot?: EngineSnapshotMessage;
        offsetMs?: unknown;
      };
      const s = raw.snapshot;
      if (s?.kind !== 'snapshot' || s.version !== ENGINE_STATE_VERSION || typeof s.rev !== 'number')
        return null;
      return { snapshot: s, offsetMs: typeof raw.offsetMs === 'number' ? raw.offsetMs : 0 };
    } catch {
      return null;
    }
  }

  writeShow(snapshot: EngineSnapshotMessage, offsetMs: number): void {
    writeWhole(this.showFile, JSON.stringify({ savedAt: new Date().toISOString(), offsetMs, snapshot }));
  }
}

/** Keep the last show state on disk, at most once a second, never in the way of a change. */
export class ShowSaver {
  private timer: NodeJS.Timeout | null = null;
  private pending: { snapshot: EngineSnapshotMessage; offsetMs: number } | null = null;

  constructor(
    private readonly store: NodeStore,
    private readonly warn: (message: string) => void,
    private readonly everyMs = 1000,
  ) {}

  update(snapshot: EngineSnapshotMessage, offsetMs: number): void {
    this.pending = { snapshot, offsetMs };
    this.timer ??= setTimeout(() => {
      this.flush();
    }, this.everyMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    try {
      this.store.writeShow(p.snapshot, p.offsetMs);
    } catch (error) {
      this.warn(`Could not keep the last picture (${(error as Error).message})`);
    }
  }
}
