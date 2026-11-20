import { afterEach, expect, it, vi } from 'vitest';
import { sha256File } from '../import/media-store';
import { ProxyService } from './proxy-service';
import { copyFixture } from './video-copy-fixtures';
import { registerProxyFile } from './video-copy-files';

let fixture: Awaited<ReturnType<typeof copyFixture>>;
let proxies: ProxyService;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
it('automatically prepares one aspect-correct 1080p playing copy while idle and preserves source markers', async () => {
  fixture = await copyFixture({ large: true });
  cleanup.push(() => fixture.cleanup());
  const points = { startMs: 40, endMs: 360, markers: [{ id: 'own', name: 'Placeholder point', atMs: 200 }] };
  fixture.media.setMarkers('source', points);
  let kept: unknown = null;
  const deps = {
    mediaDir: fixture.dir,
    row: (id: string) => fixture.media.about(id),
    sourceIds: () => ['source'],
    computer: () => ({ logicalCores: 2, softwareVideo: false }),
    idle: () => fixture.idle(),
    conversions: fixture.conversions,
    kept: {
      load: () => kept,
      save: (value: unknown) => {
        kept = value;
      },
    },
    register: (file: string, info: typeof fixture.info, signal: AbortSignal) =>
      registerProxyFile({
        db: fixture.db,
        mediaDir: fixture.dir,
        file,
        info,
        idle: () => fixture.idle(),
        freeBytes: () => 100 * 1024 ** 3,
        signal,
      }),
  };
  proxies = new ProxyService(deps);
  cleanup.push(() => proxies.close());
  const queued = vi.spyOn(fixture.conversions, 'saveCopy');
  // No explicit status request starts it: the idle sweep discovers the library source.
  proxies.resume();
  await vi.waitFor(
    () => {
      const result = proxies.get('source');
      if (!result.ok) throw new Error(result.message);
      if (result.proxy.state === 'failed') throw new Error(result.proxy.message ?? 'Proxy failed.');
      expect(result.proxy.state).toBe('ready');
    },
    { timeout: 10_000 },
  );
  const ready = proxies.get('source');
  if (!ready.ok) throw new Error(ready.message);
  expect(ready.proxy).toMatchObject({ required: true, width: 1920, height: 1080 });
  expect(ready.proxy.readyMediaId).not.toBe('source');
  expect(proxies.readyFor('source').mediaId).toBe(ready.proxy.readyMediaId);
  expect(proxies.sourceOf(ready.proxy.readyMediaId ?? '')).toBe('source');
  expect(fixture.media.markersOf('source')).toEqual(points);
  expect((await sha256File(fixture.source)).sha256).toBe(fixture.sha);
  expect(fixture.maxActive()).toBe(1);
  expect(queued).toHaveBeenCalledTimes(1);
  proxies.close();
  proxies = new ProxyService(deps);
  expect(proxies.get('source')).toMatchObject({
    ok: true,
    proxy: { state: 'ready', readyMediaId: ready.proxy.readyMediaId },
  });
  expect(queued).toHaveBeenCalledTimes(1);
  proxies.close();
  let publicationAttempted = false;
  proxies = new ProxyService({
    ...deps,
    kept: {
      load: () => null,
      save: (value: unknown) => {
        const saved = value as { readyId: string | null }[];
        if (saved.some((item) => item.readyId && item.readyId !== 'source')) {
          publicationAttempted = true;
          throw new Error('Placeholder manifest is held.');
        }
      },
    },
  });
  await vi.waitFor(
    () => {
      proxies.get('source');
      expect(publicationAttempted).toBe(true);
    },
    { timeout: 10_000 },
  );
  expect(proxies.get('source')).toMatchObject({ ok: true, proxy: { state: 'failed', readyMediaId: null } });
  expect(proxies.readyFor('source').mediaId).toBeNull();
}, 15_000);
