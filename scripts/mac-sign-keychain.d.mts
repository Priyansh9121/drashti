export const IDENTITY: string;
export class SigningKeychainError extends Error {}
/** A failed security command: its subcommand and a reason code, never its arguments or output. */
export class SecurityCommandError extends SigningKeychainError {
  readonly subcommand: string;
  readonly failure: ImportFailure;
}
export type ImportFailure = 'password' | 'format' | 'invalid' | 'unknown' | 'timeout';
export function importFailure(output: string): ImportFailure;
export function importReason(failure: ImportFailure, pfx: boolean): string;
export const NOT_A_P12: string;
export function decodeP12(encoded: string): Buffer;
export interface P12Description {
  pfx: boolean;
  encryption: string[];
  mac: string;
  line: string;
}
export function describeP12(bytes: Uint8Array): P12Description;
export function signingSourceAllowed(event: string | undefined, ref: string | undefined): boolean;
export function importArgs(p12: string, keychain: string, password: string): string[];
export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr?: string;
  signal?: string | null;
  error?: Error & { code?: string };
}
export interface SpawnOptions {
  encoding: 'utf8';
  timeout: number;
  killSignal: 'SIGKILL';
}
export type Spawn = (command: string, args: string[], options: SpawnOptions) => SpawnResult;
/** Every call is bounded: `timeoutMs` (default COMMAND_TIMEOUT_MS), then killed. */
export type Security = (args: string[], administrator?: boolean, timeoutMs?: number) => string;
export const COMMAND_TIMEOUT_MS: number;
export const TRUST_REMOVAL_TIMEOUT_MS: number;
export function securityRunner(spawn?: Spawn): Security;
export interface KeychainDeps {
  env: Record<string, string | undefined>;
  platform: string;
  security: Security;
  log: (line: string) => void;
  error: (line: string) => void;
}
export function runCli(argv: string[], deps: KeychainDeps): number;
