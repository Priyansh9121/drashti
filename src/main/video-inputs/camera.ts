import type { CameraAccess } from '../../shared/video-inputs';

/*
 * Whether Drashti may use this computer's cameras (Session 50), as the system says. A Mac asks the person at it
 * the first time (macOS's own question, after the page has said why), and once refused only System Settings
 * can turn it on again; Windows never asks: its camera privacy setting ("Let desktop apps access your camera")
 * decides, and Electron reports it as denied while it is off. Only these two fixed Settings pages are ever
 * opened. Tests never ask or open anything: Chromium's fake camera stands in, and a test may say how the
 * setting stands (DRASHTI_TEST_CAMERA_ACCESS).
 */

/** System Settings › Privacy & Security › Camera (a Mac). */
export const MAC_CAMERA_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera';
/** Settings › Privacy & security › Camera (Windows). */
export const WINDOWS_CAMERA_SETTINGS = 'ms-settings:privacy-webcam';

/** The system's side, as Electron gives it (./electron-camera.ts); stand-ins in tests. */
export interface CameraOs {
  /** systemPreferences.getMediaAccessStatus('camera') (a Mac and Windows only). */
  status(): CameraAccess;
  /** systemPreferences.askForMediaAccess('camera') (a Mac only). */
  ask(): Promise<boolean>;
  /** shell.openExternal, only ever with one of the two pages above. */
  open(url: string): Promise<void>;
}

/** What the video inputs ask of the system. */
export interface CameraSystem {
  /** Whether Drashti may use the cameras now. */
  access(): CameraAccess;
  /** A Mac: ask (macOS's question, the first time only); elsewhere nothing to ask. How it stands then. */
  ask(): Promise<CameraAccess>;
  /** System Settings (Windows' Settings) at the camera's privacy page. */
  openSettings(): Promise<void>;
}

const ACCESS_WORDS: readonly CameraAccess[] = [
  'granted',
  'denied',
  'not-determined',
  'restricted',
  'unknown',
];
const isAccess = (word: string | undefined): word is CameraAccess =>
  word !== undefined && (ACCESS_WORDS as readonly string[]).includes(word);

export function cameraSystem(
  platform: NodeJS.Platform,
  os: CameraOs,
  test: { fake?: boolean; access?: string | undefined; log?: (line: string) => void } = {},
): CameraSystem {
  /** A test's word for how the setting stands, or null. */
  let given: CameraAccess | null = isAccess(test.access) ? test.access : null;
  const testing = test.fake === true || given !== null;
  const system = platform === 'darwin' || platform === 'win32';
  const access = (): CameraAccess => {
    if (given !== null) return given;
    if (test.fake === true || !system) return 'granted';
    return os.status();
  };
  return {
    access,
    ask: async () => {
      if (testing) {
        // As if the person at the Mac allowed it when asked (a refusal is a test's own 'denied').
        if (given === 'not-determined') given = 'granted';
        return access();
      }
      if (platform === 'darwin' && os.status() === 'not-determined') await os.ask();
      return access();
    },
    openSettings: async () => {
      if (testing) {
        test.log?.('Camera: would open the privacy settings at Camera (a test)');
        return;
      }
      if (platform === 'darwin') await os.open(MAC_CAMERA_SETTINGS);
      else if (platform === 'win32') await os.open(WINDOWS_CAMERA_SETTINGS);
    },
  };
}
