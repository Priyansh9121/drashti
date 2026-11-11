import { execFile } from 'node:child_process';
import { whisperDependencyProblem } from './engine-place';

/** Start the packaged captions engine and let the OS load its libraries, without opening a model or microphone. */
export function whisperSelfTest(
  path: string | null,
  platform: NodeJS.Platform,
): Promise<{ passed: boolean; detail: string }> {
  if (!path) return Promise.resolve({ passed: false, detail: 'The bundled captions engine is missing.' });
  return new Promise((resolve) => {
    execFile(path, ['--help'], { timeout: 10_000, windowsHide: true }, (error, out, err) => {
      const passed = error === null && /--request-path\s/u.test(`${out}\n${err}`);
      const code = typeof error?.code === 'number' ? error.code : null;
      resolve({
        passed,
        detail: passed
          ? 'The bundled captions engine starts and accepts a private request path.'
          : (whisperDependencyProblem(platform, code) ??
            'The bundled captions engine failed to start or does not support a private request path.'),
      });
    });
  });
}
