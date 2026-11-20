import { expect, it } from 'vitest';
import { PLAIN_VIDEO_EDIT, saveVideoEditSchema } from '../../shared/video-edit';
it('accepts at most 50 chosen scene times outside the strict recipe and rejects malformed times', () => {
  const request = { mediaId: 'source', revision: 0, recipe: PLAIN_VIDEO_EDIT, sceneMarkers: [2500] };
  expect(saveVideoEditSchema.safeParse(request).success).toBe(true);
  for (const sceneMarkers of [[-1], [0.5], [86_400_001], Array.from({ length: 51 }, (_, i) => i)])
    expect(saveVideoEditSchema.safeParse({ ...request, sceneMarkers }).success).toBe(false);
});
