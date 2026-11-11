export default function copyWhisperWindowsRuntime(context: {
  electronPlatformName: string;
  appOutDir: string;
  packager: { projectDir: string };
}): Promise<void>;
