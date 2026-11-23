import { z } from 'zod';

/** Automatic uploads accept only machine vocabulary, never an error's arbitrary text. */
export const ERROR_CODES = ['operation-failed', 'process-crashed', 'stream-failed'] as const;
export const EVENT_CODES = [
  ...ERROR_CODES,
  'app-started',
  'import-completed',
  'show-started',
  'stream-started',
  'stream-stopped',
] as const;
export const DAY = 86_400_000;
export const ERROR_LIMITS = { perDay: 10, pending: 20, ageMs: 7 * DAY, bytes: 65_536, events: 30 } as const;
const count = z.number().int().min(0).max(1_000_000_000);
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const countsSchema = z
  .object({ minutes: count, shows: count, streams: count, recordings: count, imports: count })
  .strict();
export const eventSchema = z.object({ at: time, code: z.enum(EVENT_CODES), count }).strict();
export const identitySchema = z
  .object({
    diagnosticsInstallId: z
      .string()
      .regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u)
      .nullable(),
    mode: z.enum(['pro', 'simple']),
    osRelease: z.string().regex(/^\d{1,5}(?:\.\d{1,5}){1,3}$/u),
    computerId: z.string().regex(/^[a-f0-9]{64}$/u),
    accessEntryId: z.string().regex(/^[a-f0-9]{32}$/u),
    version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-alpha\.\d{1,4}(?:\.\d{1,3})?)?$/u),
    platform: z.enum(['darwin', 'win32']),
    arch: z.enum(['arm64', 'x64', 'ia32']),
    role: z.enum(['main', 'node']),
    counts: countsSchema,
  })
  .strict();
export const reportSchema = identitySchema
  .extend({
    id: z.string().regex(/^[a-f0-9]{32}$/u),
    at: time,
    trigger: z.enum(['operator-error', 'crash', 'failed-stream']),
    code: z.enum(ERROR_CODES),
    dropped: count,
    events: z.array(eventSchema).max(ERROR_LIMITS.events),
  })
  .strict();
export type AutomaticReport = z.infer<typeof reportSchema>;
export type ErrorEvent = z.infer<typeof eventSchema>;
export type ErrorIdentity = z.infer<typeof identitySchema>;
export type Incident = ErrorIdentity & Pick<AutomaticReport, 'trigger' | 'code' | 'events'>;
export const configSchema = z
  .object({
    endpoint: z.string().regex(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/u),
    installId: z.string().regex(/^[a-f0-9]{32}$/u),
    secret: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type ErrorReportConfig = z.infer<typeof configSchema>;
export const MAC_PREFIX = 'drashti-errors-v1\n';
