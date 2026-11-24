import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS, type CaptionsStatus } from '../../shared/captions';
import type { Heard, SpeechState } from '../../shared/speech';
import { CaptionsService } from './captions-service';
import type * as Switch from './captions-switch';
import type { SpeechEngine } from './hub';

/*
 * Captions that stop because this computer is too slow (cap-threads) when Off cannot be saved: a full disk (a
 * recording filled it) or a file Windows holds locked (cap-review-threads SHOULD-1). They still turn off, the engine
 * stopped (so Route W gives its pack back), and the dialog's words stay true. Saving is pretended to fail here.
 */

const saving = vi.hoisted(() => ({ fails: false }));
vi.mock('./captions-switch', async (importOriginal) => {
  const real = await importOriginal<typeof Switch>();
  return {
    ...real,
    writeCaptionsSwitch: (...args: Parameters<typeof real.writeCaptionsSwitch>) => {
      if (saving.fails) throw Object.assign(new Error('placeholder: no space left'), { code: 'ENOSPC' });
      real.writeCaptionsSwitch(...args);
    },
  };
});

describe('captions that stop as too slow, when Off cannot be saved (cap-review-threads SHOULD-1)', () => {
  it('still turn off: the engine stopped, the reason kept, the failure logged by its code, nothing thrown', async () => {
    let out: { heard(h: Heard): void; state(s: SpeechState): void } | null = null;
    let stopped = 0;
    const engine: SpeechEngine = {
      start(language, to) {
        out = to;
        to.state({ phase: 'listening', language });
        return () => {
          stopped += 1;
          out = null;
        };
      },
    };
    const warnings: string[] = [];
    const views: CaptionsStatus[] = [];
    const service = new CaptionsService({
      userData: mkdtempSync(join(tmpdir(), 'drashti-captions-stop-')),
      platform: 'win32',
      arch: 'x64',
      repo: { get: () => ({ ...DEFAULT_CAPTION_SETTINGS }), set: () => undefined },
      engine,
      engineProblem: () => null,
      modelReady: () => true,
      download: () => Promise.resolve(),
      show: () => undefined,
      changed: (v) => views.push(v),
      log: { info: () => undefined, warn: (m) => warnings.push(m) },
    });
    service.start();
    await service.setOn(true);
    expect(service.view().speech).toMatchObject({ phase: 'listening' });
    saving.fails = true;
    try {
      const state = (s: SpeechState): void => {
        (out as { state(s: SpeechState): void } | null)?.state(s);
      };
      state({
        phase: 'held',
        reason: 'busy',
        slow: {
          answerMs: 15_500,
          behindMs: 16_000,
          threads: 2,
          processors: 2,
          rests: 3,
          keptUp: false,
          stops: true,
        },
      });
      await vi.waitFor(() => {
        expect(service.view().on).toBe(false);
      });
      expect(stopped).toBe(1);
      expect(service.view()).toMatchObject({ speech: { phase: 'off' }, stopped: { slow: { rests: 3 } } });
      expect(views.at(-1)).toMatchObject({ on: false });
      expect(warnings.join('\n')).toMatch(/could not be saved.*ENOSPC/u);
      expect(warnings.join('\n')).not.toContain(tmpdir());
    } finally {
      saving.fails = false;
      service.close();
    }
  });
});
