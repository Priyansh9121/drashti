import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import windowsRuntimeLibraries from '../../shared/whisper-windows-runtime.json';
import { whisperDependencyProblem } from './engine-place';

/** Start the packaged captions engine and let the OS load its libraries, without opening a model or microphone. */
export function whisperSelfTest(
  path: string | null,
  platform: NodeJS.Platform,
): Promise<{ passed: boolean; detail: string }> {
  if (!path) return Promise.resolve({ passed: false, detail: 'The bundled captions engine is missing.' });
  if (platform === 'win32') {
    const folder = dirname(path);
    const missing = Object.keys(windowsRuntimeLibraries).filter(
      (file) => !statSync(join(folder, file), { throwIfNoEntry: false })?.isFile(),
    );
    if (missing.length)
      return Promise.resolve({
        passed: false,
        detail: `The bundled captions engine is missing app-local Windows libraries (${missing.join(', ')}).`,
      });
  }
  return new Promise((resolve) => {
    execFile(path, ['--help'], { timeout: 10_000, windowsHide: true }, (error, out, err) => {
      const passed = error === null && /--request-path\s/u.test(`${out}\n${err}`);
      const code = typeof error?.code === 'number' ? error.code : null;
      resolve({
        passed,
        detail: passed
          ? platform === 'win32'
            ? 'The bundled captions engine starts, accepts a private request path, and has its app-local x64 runtime.'
            : 'The bundled captions engine starts and accepts a private request path.'
          : (whisperDependencyProblem(platform, code) ??
            'The bundled captions engine failed to start or does not support a private request path.'),
      });
    });
  });
}
