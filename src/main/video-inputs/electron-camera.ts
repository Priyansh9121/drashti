import { shell, systemPreferences } from 'electron';
import { type CameraSystem, cameraSystem } from './camera';

/*
 * The camera's system setting through Electron (Session 50; ./camera.ts says what each platform does). Never
 * read as Drashti starts: only when a page asks how it stands (Media's Video inputs, a notice).
 */
export function electronCamera(
  platform: NodeJS.Platform,
  test: { fake: boolean; access: string | undefined; log: (line: string) => void },
): CameraSystem {
  return cameraSystem(
    platform,
    {
      status: () => systemPreferences.getMediaAccessStatus('camera'),
      ask: () => systemPreferences.askForMediaAccess('camera'),
      open: (url) => shell.openExternal(url),
    },
    test,
  );
}
