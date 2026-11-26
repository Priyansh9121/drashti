export const IDENTITY: string;
export class SigningKeychainError extends Error {}
export function signingSourceAllowed(event: string | undefined, ref: string | undefined): boolean;
export function importArgs(p12: string, keychain: string, password: string): string[];
export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr?: string;
}
export type Spawn = (command: string, args: string[], options: { encoding: 'utf8' }) => SpawnResult;
export type Security = (args: string[], administrator?: boolean) => string;
export function securityRunner(spawn?: Spawn): Security;
export interface KeychainDeps {
  env: Record<string, string | undefined>;
  platform: string;
  security: Security;
  log: (line: string) => void;
  error: (line: string) => void;
}
export function runCli(argv: string[], deps: KeychainDeps): number;
