import { constants } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import libraries from '../src/shared/whisper-windows-runtime.json' with { type: 'json' };

// The Windows extraResources signing pass has finished. Redistribute Microsoft's DLLs unchanged.
export default async function copyWhisperWindowsRuntime({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'win32') return;
  const source = join(packager.projectDir, 'vendor', 'whisper', 'win32-x64');
  const destination = join(appOutDir, 'resources', 'whisper');
  await mkdir(join(appOutDir, 'resources', 'indic'), { recursive: true });
  for (const name of Object.keys(libraries)) {
    await copyFile(join(source, name), join(destination, name), constants.COPYFILE_EXCL);
    // ONNX Runtime uses the same existing Microsoft app-local CRT, beside its separate helper.
    await copyFile(join(source, name), join(appOutDir, 'resources', 'indic', name), constants.COPYFILE_EXCL);
  }
}
