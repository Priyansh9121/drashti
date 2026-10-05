import { getDiffieHellman } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { confirmation, GROUP_PRIME_HEX, pakeKey, readShare, sameConfirmation, startPake } from './pake';

/* Pairing a node: the key exchange (made-up codes and fingerprints only). */

const MAIN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** Both sides of one exchange: the node with its code and the fingerprint it saw, Main with its own. */
function exchange(nodeCode: string, nodeSaw: string, mainCode: string, mainHas: string) {
  const node = startPake(nodeCode, nodeSaw);
  const main = startPake(mainCode, mainHas);
  const nodeKey = pakeKey(node, main.share, {
    fingerprint: nodeSaw,
    nodeShare: node.share,
    mainShare: main.share,
  });
  const mainKey = pakeKey(main, node.share, {
    fingerprint: mainHas,
    nodeShare: node.share,
    mainShare: main.share,
  });
  if (!nodeKey || !mainKey) throw new Error('a share was refused');
  return { nodeKey, mainKey };
}

describe('the pairing key exchange', () => {
  it('uses the platform’s own copy of the RFC 3526 2048-bit group', () => {
    expect(GROUP_PRIME_HEX).toBe(getDiffieHellman('modp14').getPrime('hex').replace(/^0+/u, ''));
  });

  it('agrees on a key when the code and the certificate are the same, and each side can prove it', () => {
    const { nodeKey, mainKey } = exchange('482913', MAIN, '482913', MAIN);
    expect(nodeKey.equals(mainKey)).toBe(true);
    expect(sameConfirmation(confirmation(nodeKey, 'node'), confirmation(mainKey, 'node'))).toBe(true);
    // The two proofs differ, so one side's cannot be sent back as the other's.
    expect(confirmation(mainKey, 'main')).not.toBe(confirmation(mainKey, 'node'));
  });

  it('does not agree with a wrong code, or when the node saw another certificate (someone in between)', () => {
    const wrongCode = exchange('482914', MAIN, '482913', MAIN);
    expect(wrongCode.nodeKey.equals(wrongCode.mainKey)).toBe(false);
    const between = exchange('482913', OTHER, '482913', MAIN);
    expect(between.nodeKey.equals(between.mainKey)).toBe(false);
    expect(
      sameConfirmation(confirmation(between.nodeKey, 'node'), confirmation(between.mainKey, 'node')),
    ).toBe(false);
  });

  it('refuses shares that are not in the group, and proofs that are not one', () => {
    for (const bad of ['0', '1', 'zz', '', 42, null, 'f'.repeat(513)]) expect(readShare(bad)).toBeNull();
    // p - 1 has order two: refused.
    expect(readShare((BigInt(`0x${GROUP_PRIME_HEX}`) - 1n).toString(16))).toBeNull();
    // A number outside the subgroup of order q (2 is a generator of it, 2 * 2 is in it; -4 is not).
    expect(readShare((BigInt(`0x${GROUP_PRIME_HEX}`) - 4n).toString(16))).toBeNull();
    expect(readShare('4')).not.toBeNull();
    const own = startPake('482913', MAIN);
    expect(
      pakeKey(own, 'nonsense', { fingerprint: MAIN, nodeShare: own.share, mainShare: own.share }),
    ).toBeNull();
    expect(sameConfirmation('nope', 'a'.repeat(64))).toBe(false);
    expect(sameConfirmation(undefined, 'a'.repeat(64))).toBe(false);
  });

  it('makes a fresh share every time, the same length every time', () => {
    const a = startPake('482913', MAIN);
    const b = startPake('482913', MAIN);
    expect(a.share).not.toBe(b.share);
    expect(a.share).toHaveLength(512);
    expect(b.share).toHaveLength(512);
  });
});
