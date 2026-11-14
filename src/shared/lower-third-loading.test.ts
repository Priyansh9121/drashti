import { expect, it, vi } from 'vitest';

it('loads live lower-third playback and the Performance entry point without evaluating the Studio designs', async () => {
  vi.doMock('./lower-third-designs', () => {
    throw new Error('The Studio designs loaded on the playback path');
  });
  // Nor the templates made since alpha.17 (Session 58), which the lower-thirds-more scenario loads only as it plays.
  vi.doMock('./lower-third-designs-more', () => {
    throw new Error('The Studio designs made since alpha.17 loaded on the playback path');
  });
  try {
    await expect(import('./lower-third-animations')).resolves.toHaveProperty('animationById');
    await expect(import('./lower-third-studio')).resolves.toHaveProperty('OFFERED');
    await expect(import('../main/lower-thirds/perf-lower-thirds')).resolves.toHaveProperty(
      'lowerThirdsScenario',
    );
  } finally {
    vi.doUnmock('./lower-third-designs');
    vi.doUnmock('./lower-third-designs-more');
  }
});
