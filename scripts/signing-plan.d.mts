export interface SigningPlan {
  /** electron-builder's environment. */
  env: Record<string, string | undefined>;
  /** electron-builder's extra arguments. */
  extra: string[];
  /** What the log says after "Signing: ". */
  how: string;
  /** release-signing.json, for scripts/verify-signing.mjs. */
  record: { platform: string; signed: boolean; notarised: boolean; kind?: 'own' };
}
export function signingPlan(options: {
  platform: string;
  given: Record<string, string | undefined>;
  writeSecret: (name: string, data: string | Buffer) => string;
}): SigningPlan;
