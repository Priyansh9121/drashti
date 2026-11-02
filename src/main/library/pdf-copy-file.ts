import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { isInside } from '../media/contained';

export const MAX_PDF_COPY_BYTES = 64 * 1024 * 1024;
export interface PdfCopyRequest {
  bytes: Uint8Array;
  /** Main's native Save dialog choice, never a renderer-provided path. */
  outputPath: string;
  mediaDir: string;
  /** Main-known immutable managed originals and external source file paths. */
  protectedSources: readonly string[];
  signal?: AbortSignal;
  /** Main's current editor/permission/sender-generation admission. */
  current?(): boolean;
}
export interface PdfCopyControl {
  /** Main/test-only interleaving seam; this path never crosses IPC. */
  beforePublish?(stagedFile: string): Promise<void>;
}
export class PdfCopyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PdfCopyError';
  }
}
interface FolderSnapshot {
  chosen: string;
  canonical: string;
  identity: BigIntStats;
}
interface SourceSnapshot {
  chosen: string;
  canonical: string;
  identity: BigIntStats | null;
}
interface Protections {
  media: FolderSnapshot;
  sources: SourceSnapshot[];
}
interface OutputSnapshot {
  parent: FolderSnapshot;
  file: string;
  identity: BigIntStats | null;
}

function stopped(request: PdfCopyRequest): void {
  if (request.signal?.aborted || (request.current && !request.current()))
    throw new PdfCopyError('cancelled', 'Saving the PDF copy was cancelled before publication.');
}
function unsafe(): never {
  throw new PdfCopyError(
    'unsafe-output',
    'Choose a regular output file outside managed media and the protected source files.',
  );
}
function changed(): never {
  throw new PdfCopyError(
    'changed-output',
    'The chosen output or its protected source locations changed. Choose the output again.',
  );
}
function corrupt(): never {
  throw new PdfCopyError(
    'corrupt-staging',
    'The staged PDF copy could not be verified; the existing output was left unchanged.',
  );
}
async function checked<T>(request: PdfCopyRequest, action: () => Promise<T>): Promise<T> {
  stopped(request);
  try {
    const value = await action();
    stopped(request);
    return value;
  } catch (error) {
    stopped(request);
    throw error;
  }
}
function codeIs(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
async function maybeStat(file: string, request: PdfCopyRequest): Promise<BigIntStats | null> {
  try {
    return await checked(request, () => lstat(file, { bigint: true }));
  } catch (error) {
    if (codeIs(error, 'ENOENT')) return null;
    throw error;
  }
}
function sameInode(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function sameFile(a: BigIntStats | null, b: BigIntStats | null): boolean {
  if (!a || !b) return a === b;
  return (
    sameInode(a, b) &&
    a.mode === b.mode &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
async function folder(chosen: string, request: PdfCopyRequest): Promise<FolderSnapshot> {
  const canonical = await checked(request, () => realpath(chosen));
  const identity = await checked(request, () => lstat(canonical, { bigint: true }));
  if (!identity.isDirectory() || identity.isSymbolicLink()) unsafe();
  return { chosen, canonical, identity };
}
function sameFolder(a: FolderSnapshot, b: FolderSnapshot): boolean {
  return a.canonical === b.canonical && sameInode(a.identity, b.identity);
}
/** Resolve missing external source names through the nearest existing ancestor.
 * A missing original stays protected if it is recreated while the copy runs. */
async function missingCanonical(file: string, request: PdfCopyRequest): Promise<string> {
  let ancestor = file;
  const suffix: string[] = [];
  for (;;) {
    try {
      return join(await checked(request, () => realpath(ancestor)), ...suffix.toReversed());
    } catch (error) {
      if (!codeIs(error, 'ENOENT')) throw error;
      const existing = await maybeStat(ancestor, request);
      if (existing?.isSymbolicLink()) unsafe();
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.push(basename(ancestor));
      ancestor = parent;
    }
  }
}
async function source(chosen: string, request: PdfCopyRequest): Promise<SourceSnapshot> {
  if (!isAbsolute(chosen)) unsafe();
  const entry = await maybeStat(chosen, request);
  if (!entry) return { chosen, canonical: await missingCanonical(chosen, request), identity: null };
  // An existing source symlink protects its real target too. A broken symlink
  // refuses the operation rather than treating an unresolved alias as absent.
  const canonical = await checked(request, () => realpath(chosen));
  const identity = await checked(request, () => lstat(canonical, { bigint: true }));
  if (!identity.isFile() || identity.isSymbolicLink()) unsafe();
  return { chosen, canonical, identity };
}
async function protections(request: PdfCopyRequest): Promise<Protections> {
  if (!isAbsolute(request.mediaDir)) unsafe();
  const media = await folder(request.mediaDir, request);
  const sources: SourceSnapshot[] = [];
  for (const path of request.protectedSources) sources.push(await source(path, request));
  return { media, sources };
}
async function output(request: PdfCopyRequest): Promise<OutputSnapshot> {
  if (!isAbsolute(request.outputPath)) unsafe();
  const parent = await folder(dirname(request.outputPath), request);
  const candidate = join(parent.canonical, basename(request.outputPath));
  const identity = await maybeStat(candidate, request);
  if (!identity) return { parent, file: candidate, identity: null };
  if (!identity.isFile() || identity.isSymbolicLink()) unsafe();
  const file = await checked(request, () => realpath(candidate));
  const again = await maybeStat(candidate, request);
  if (again?.isSymbolicLink()) unsafe();
  if (!sameFile(identity, again) || dirname(file) !== parent.canonical) changed();
  return { parent, file, identity };
}
function safeOutput(target: OutputSnapshot, protectedFiles: Protections): void {
  if (target.file === protectedFiles.media.canonical || isInside(protectedFiles.media.canonical, target.file))
    unsafe();
  for (const original of protectedFiles.sources) {
    if (
      target.file === original.canonical ||
      (target.identity && original.identity && sameInode(target.identity, original.identity))
    )
      unsafe();
  }
}
function unchangedProtections(before: Protections, after: Protections): void {
  if (!sameFolder(before.media, after.media) || before.sources.length !== after.sources.length) changed();
  for (const [index, old] of before.sources.entries()) {
    const current = after.sources[index];
    if (
      current?.chosen !== old.chosen ||
      current.canonical !== old.canonical ||
      !sameFile(old.identity, current.identity)
    )
      changed();
  }
}
function validPdf(bytes: Uint8Array): Buffer {
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_PDF_COPY_BYTES)
    throw new PdfCopyError('invalid-pdf', 'The generated PDF copy is empty or exceeds the 64 MiB limit.');
  const frozen = Buffer.from(bytes);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:[\r\n ]|$)/u.test(frozen.subarray(0, 16).toString('latin1')))
    throw new PdfCopyError('invalid-pdf', 'The generated copy does not have a PDF signature.');
  let end = frozen.length;
  while (end > 0 && [0, 9, 10, 12, 13, 32].includes(frozen[end - 1] ?? -1)) end--;
  if (!frozen.subarray(Math.max(0, end - 5), end).equals(Buffer.from('%%EOF')))
    throw new PdfCopyError('invalid-pdf', 'The generated PDF copy is incomplete.');
  return frozen;
}
async function verifyStaged(
  file: string,
  expected: BigIntStats,
  hash: string,
  size: number,
  request: PdfCopyRequest,
): Promise<void> {
  const pathStat = await checked(request, () => lstat(file, { bigint: true }));
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || !sameFile(pathStat, expected)) corrupt();
  let handle: FileHandle | null = null;
  try {
    stopped(request);
    handle = await open(file, 'r');
    stopped(request);
    const own = handle;
    const opened = await checked(request, () => own.stat({ bigint: true }));
    if (!sameFile(opened, expected)) corrupt();
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(128 * 1024);
    let bytes = 0;
    for (;;) {
      const result = await checked(request, () => own.read(buffer, 0, buffer.length, bytes));
      if (result.bytesRead === 0) break;
      bytes += result.bytesRead;
      if (bytes > MAX_PDF_COPY_BYTES) corrupt();
      digest.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await checked(request, () => own.stat({ bigint: true }));
    if (bytes !== size || digest.digest('hex') !== hash || !sameFile(opened, after)) corrupt();
  } finally {
    // Cleanup must still close owned descriptors after admission is withdrawn.
    if (handle) await handle.close();
  }
  stopped(request);
}
async function cleanup(file: string, identity: BigIntStats): Promise<void> {
  try {
    const current = await lstat(file, { bigint: true });
    // Never delete an unknown replacement which someone put at the private name.
    if (current.isFile() && !current.isSymbolicLink() && sameInode(current, identity)) await unlink(file);
  } catch (error) {
    if (!codeIs(error, 'ENOENT')) throw error;
  }
}

/**
 * Save a new generated PDF beside a Main-chosen ordinary output. This validates
 * signature/size and exact staged bytes; the upstream trusted-print pipeline is
 * responsible for PDF content/geometry validation, not this file writer.
 *
 * All admission/cancellation/protection checks precede final rename. Rename is
 * the commit boundary: once it succeeds return success even if admission changes
 * while that OS call was in flight. Never claim cancellation after publication.
 *
 * Node has no portable conditional compare-and-rename across Mac and Windows:
 * a hostile filesystem actor can still race the final recheck and rename. Do
 * not broaden replacement authority beyond the exact native Save dialog choice.
 */
export async function writePdfCopy(request: PdfCopyRequest, control: PdfCopyControl = {}): Promise<void> {
  stopped(request);
  const bytes = validPdf(request.bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const protectedFiles = await protections(request);
  const target = await output(request);
  safeOutput(target, protectedFiles);
  const staged = join(target.parent.canonical, '.drashti-pdf-' + randomUUID() + '.tmp');
  let handle: FileHandle | null = null;
  let owned: BigIntStats | null = null;
  let created = false;
  let committed = false;
  try {
    // Confirm the chosen parent again immediately before private creation.
    if (!sameFolder(target.parent, await folder(target.parent.chosen, request))) changed();
    stopped(request);
    handle = await open(staged, 'wx', 0o600);
    created = true;
    const writer = handle;
    stopped(request);
    owned = await checked(request, () => writer.stat({ bigint: true }));
    await checked(request, () => writer.writeFile(bytes, { signal: request.signal }));
    await checked(request, () => writer.sync());
    owned = await checked(request, () => writer.stat({ bigint: true }));
    await writer.close();
    handle = null;
    stopped(request);
    if (control.beforePublish) {
      stopped(request);
      await control.beforePublish(staged);
      stopped(request);
    }
    await verifyStaged(staged, owned, hash, bytes.length, request);
    const currentProtected = await protections(request);
    const currentTarget = await output(request);
    safeOutput(currentTarget, protectedFiles);
    safeOutput(currentTarget, currentProtected);
    unchangedProtections(protectedFiles, currentProtected);
    if (
      !sameFolder(target.parent, currentTarget.parent) ||
      target.file !== currentTarget.file ||
      !sameFile(target.identity, currentTarget.identity)
    )
      changed();
    const finalStaged = await checked(request, () => lstat(staged, { bigint: true }));
    if (!finalStaged.isFile() || finalStaged.isSymbolicLink() || !sameFile(owned, finalStaged)) corrupt();
    stopped(request);
    await rename(staged, target.file);
    // No throwing admission check after this successful commit boundary.
    committed = true;
  } catch (error) {
    if (codeIs(error, 'ABORT_ERR'))
      throw new PdfCopyError('cancelled', 'Saving the PDF copy was cancelled before publication.');
    throw error;
  } finally {
    try {
      if (handle) {
        try {
          if (created && !owned) owned = await handle.stat({ bigint: true });
        } finally {
          await handle.close();
        }
      }
    } finally {
      if (created && !committed && owned) await cleanup(staged, owned);
    }
  }
}
