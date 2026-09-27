import { describe, expect, it } from 'vitest';
import { applyPatch, diffState, type DescendRule } from './patch';

const twoLevels: DescendRule = (path) => path.length < 2;
const oneLevel: DescendRule = (path) => path.length < 1;

describe('diffState / applyPatch', () => {
  const base = { a: { x: 1, y: { deep: true } }, b: [1, 2], c: null as string | null };

  it('produces no ops for the same object', () => {
    expect(diffState(base, base)).toEqual([]);
  });

  it('skips unchanged branches by reference', () => {
    const next = { ...base, c: 'now' };
    expect(diffState(base, next)).toEqual([{ path: ['c'], value: 'now' }]);
  });

  it('descends only where the rule allows and sends the rest whole', () => {
    const next = { ...base, a: { ...base.a, y: { deep: false } } };
    expect(diffState(base, next, twoLevels)).toEqual([{ path: ['a', 'y'], value: { deep: false } }]);
    expect(diffState(base, next, oneLevel)).toEqual([{ path: ['a'], value: next.a }]);
  });

  it('replaces arrays whole', () => {
    const next = { ...base, b: [1, 2, 3] };
    expect(diffState(base, next)).toEqual([{ path: ['b'], value: [1, 2, 3] }]);
  });

  it('round-trips: apply(diff(a, b)) equals b', () => {
    const next = { a: { x: 2, y: { deep: true } }, b: [], c: 'z' };
    const ops = diffState(base, next, twoLevels);
    expect(applyPatch(base, ops)).toEqual(next);
  });

  it('applies without mutating and shares untouched branches', () => {
    const frozen = Object.freeze({ ...base, a: Object.freeze({ ...base.a }) });
    const out = applyPatch(frozen, [{ path: ['c'], value: 'set' }]);
    expect(out.c).toBe('set');
    expect(out.a).toBe(frozen.a);
    expect(frozen.c).toBeNull();
  });

  it('treats a removed key as null', () => {
    expect(diffState({ a: 1, b: 2 }, { a: 1 })).toEqual([{ path: ['b'], value: null }]);
  });

  it('replaces the whole value for a top-level type change', () => {
    expect(diffState({ a: 1 }, [1])).toEqual([{ path: [], value: [1] }]);
    expect(applyPatch({ a: 1 }, [{ path: [], value: 5 }])).toBe(5);
  });
});

describe('engineDescend', () => {
  it('sends live whole and each layer separately', () => {
    const prev = { live: { a: 1, b: 2 }, layers: { slide: null, props: [] as number[] }, blackout: false };
    const next = { live: { a: 1, b: 3 }, layers: { slide: null, props: [1] }, blackout: true };
    expect(diffState(prev, next).map((o) => o.path.join('.'))).toEqual(['live', 'layers.props', 'blackout']);
  });
});
