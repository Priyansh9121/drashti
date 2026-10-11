export const YT_DLP_VERSION: string;
export const DENO_VERSION: string;
export const YT_DLP_BUILDS: Record<string, { url: string; sha256: string; exe: string }>;
export const DENO_BUILDS: Record<string, { url: string; sha256: string; binarySha256: string; exe: string }>;
export function sha256Of(file: string): string;
export function verifyFile(file: string, sha256: string, what: string): void;
export function restoreFrameworkLinks(internal: string): boolean;
export function fetchYtDlp(target: string): Promise<string>;
export function fetchDeno(target: string): Promise<string>;
