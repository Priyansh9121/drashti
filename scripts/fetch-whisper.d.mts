export function windowsWhisperRuntime(redistRoot: string | null): {
  version: string;
  files: { name: string; path: string }[];
} | null;
