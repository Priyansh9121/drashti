import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Drashti's log in a data folder, as the end-to-end tests read it (startup-reads.spec.ts). Placeholder lines only.
 */

/** Every line Drashti has written to its log in `userData`. */
export function logLines(userData: string): string[] {
  return readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8').split('\n');
}
