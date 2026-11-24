export function probeLines(): string[];
export function judgeProbe(output: string, code: number | null): { passed: boolean; problems: string[] };
export function probeTranslate(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ passed: boolean; problems: string[]; output: string }>;
