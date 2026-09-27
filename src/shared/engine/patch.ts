import { type PatchOp } from './protocol';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Which object paths the diff looks inside; everything else is sent whole. */
export type DescendRule = (path: readonly string[]) => boolean;

/** Engine state: one op per changed top-level field, and one per changed layer. */
export const engineDescend: DescendRule = (path) =>
  path.length === 0 || (path.length === 1 && path[0] === 'layers');

/**
 * Structural diff between two immutable states. Unchanged branches are
 * skipped by reference, so it relies on updates keeping untouched objects.
 */
export function diffState(prev: unknown, next: unknown, descend: DescendRule = engineDescend): PatchOp[] {
  const ops: PatchOp[] = [];
  const walk = (a: unknown, b: unknown, path: string[]): void => {
    if (Object.is(a, b)) return;
    if (descend(path) && isPlainObject(a) && isPlainObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) walk(a[key], b[key], [...path, key]);
      return;
    }
    ops.push({ path, value: b === undefined ? null : b });
  };
  walk(prev, next, []);
  return ops;
}

/** Apply ops immutably, copying only the objects along each path. */
export function applyPatch<T>(state: T, ops: readonly PatchOp[]): T {
  let root: unknown = state;
  for (const op of ops) root = setAt(root, op.path, op.value);
  return root as T;
}

function setAt(target: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  const base: PlainObject = isPlainObject(target) ? target : {};
  return { ...base, [head]: setAt(base[head], rest, value) };
}
