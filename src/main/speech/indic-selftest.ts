import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What starting the helper said: whether it exited cleanly, its exit code and its standard output. */
export interface IndicRun {
  ok: boolean;
  code: number | null;
  out: string;
}
export interface IndicSelfTestOptions {
  path: string | null;
  platform: NodeJS.Platform;
  /** Windows: the app-local Microsoft runtime copied beside the helper (whisper-windows-runtime.json). */
  windowsRuntime: readonly string[];
  run?: (path: string, args: string[]) => Promise<IndicRun>;
}

const RUNTIME = '1.23.2';

function execRun(path: string, args: string[]): Promise<IndicRun> {
  return new Promise((resolve) => {
    // A minute: an Intel Mac build under Rosetta translates ONNX Runtime's library on its first start.
    execFile(path, args, { timeout: 60_000, windowsHide: true }, (error, out) => {
      resolve({
        ok: error === null,
        code: typeof error?.code === 'number' ? error.code : null,
        out,
      });
    });
  });
}

/**
 * The packaged app's self-test (DRASHTI_SELFTEST=ffmpeg, scripts/check-ffmpeg.mjs --packaged): Route C's helper is
 * there beside its own ONNX Runtime (and on Windows its app-local Microsoft runtime), and starts it, without any model,
 * pack, microphone or sound.
 */
export async function indicSelfTest(o: IndicSelfTestOptions): Promise<{ passed: boolean; detail: string }> {
  if (!o.path)
    return { passed: false, detail: 'The bundled Gujarati and Hindi recognition engine is missing.' };
  const beside =
    o.platform === 'win32'
      ? ['onnxruntime.dll', 'onnxruntime_providers_shared.dll', ...o.windowsRuntime]
      : ['libonnxruntime.dylib'];
  const folder = dirname(o.path);
  const missing = beside.filter((file) => !statSync(join(folder, file), { throwIfNoEntry: false })?.isFile());
  if (missing.length)
    return {
      passed: false,
      detail: `The bundled Gujarati and Hindi recognition engine is missing its libraries (${missing.join(', ')}).`,
    };
  const ran = await (o.run ?? execRun)(o.path, ['--runtime']);
  const runtime = ((): unknown => {
    try {
      return (JSON.parse(ran.out.trim()) as { runtime?: unknown }).runtime;
    } catch {
      return null;
    }
  })();
  if (ran.ok && runtime === RUNTIME)
    return {
      passed: true,
      detail:
        o.platform === 'win32'
          ? `The bundled Gujarati and Hindi recognition engine starts with ONNX Runtime ${RUNTIME} and its app-local x64 runtime.`
          : `The bundled Gujarati and Hindi recognition engine starts with ONNX Runtime ${RUNTIME}.`,
    };
  if (o.platform === 'win32' && ran.code !== null && ran.code >>> 0 === 0xc0000135)
    return {
      passed: false,
      detail:
        'The Gujarati and Hindi recognition engine is missing a Windows library. Reinstall Drashti to restore it.',
    };
  return {
    passed: false,
    detail: ran.ok
      ? `The bundled Gujarati and Hindi recognition engine started an unexpected ONNX Runtime (not ${RUNTIME}).`
      : 'The bundled Gujarati and Hindi recognition engine failed to start.',
  };
}
