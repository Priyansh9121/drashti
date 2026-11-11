import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import libraries from '../src/shared/whisper-windows-runtime.json' with { type: 'json' };

// The Windows extraResources signing pass has finished. Redistribute Microsoft's DLLs unchanged.
export default async function copyWhisperWindowsRuntime({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'win32') return;
  const source = join(packager.projectDir, 'vendor', 'whisper', 'win32-x64');
  const destination = join(appOutDir, 'resources', 'whisper');
  for (const name of Object.keys(libraries)) {
    await copyFile(join(source, name), join(destination, name), constants.COPYFILE_EXCL);
  }
}
