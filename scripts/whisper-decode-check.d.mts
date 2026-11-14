export interface ModelPin {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
}
export interface CheckLine {
  ok: boolean;
  line: string;
}
export function modelPin(modelsTs: string): ModelPin;
export function runtimeLoaded(modules: string[], folder: string, libraries: string[]): CheckLine;
export function decodeReply(status: number, body: string): CheckLine;
export function readModelPin(): ModelPin;
export function modelDir(): string;
export function fetchModel(
  pin: ModelPin,
  dir: string,
  fetch?: (url: string) => Promise<Response>,
  pause?: (ms: number) => Promise<void>,
): Promise<string>;
export function decodeCheck(given: {
  exe: string;
  ffmpeg: string;
  model: string;
  workDir: string;
  libraries: string[];
  timeoutMs?: number;
}): Promise<CheckLine[]>;
