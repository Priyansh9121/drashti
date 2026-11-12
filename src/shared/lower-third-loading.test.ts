import { expect, it, vi } from 'vitest';

it('loads live lower-third playback and the Performance entry point without evaluating the Studio designs', async () => {
  vi.doMock('./lower-third-designs', () => {
    throw new Error('The Studio designs loaded on the playback path');
  });
  try {
    await expect(import('./lower-third-animations')).resolves.toHaveProperty('animationById');
    await expect(import('./lower-third-studio')).resolves.toHaveProperty('OFFERED');
    await expect(import('../main/lower-thirds/perf-lower-thirds')).resolves.toHaveProperty(
      'lowerThirdsScenario',
    );
  } finally {
    vi.doUnmock('./lower-third-designs');
  }
});
