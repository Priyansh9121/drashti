import { z } from 'zod';
import type { MessageItem, MessagePart } from './engine/state';

/*
 * Messages (PLAN.md 4.3): templates with fields, such as "Car {plate}
 * please move". The operator fills in the fields and shows the message on
 * the audience screens; several can be up at once. A field is typed in, or
 * shows a timer live.
 */

export type MessageField = { kind: 'text' } | { kind: 'timer'; timerId: string };

export interface MessageTemplate {
  id: string;
  name: string;
  template: string;
  /** How each field in the template is filled; a field not listed is typed in. */
  fields: Record<string, MessageField>;
}

export type MessageTemplateFields = Omit<MessageTemplate, 'id'>;

export type MessageResult = { ok: true; id: string } | { ok: false; message: string };

type Piece = { kind: 'text'; text: string } | { kind: 'field'; name: string };

/** A field: letters (with their marks, for Gujarati and Hindi), digits, spaces, "_" and "-" between braces. */
const FIELD = /\{([\p{L}\p{M}\p{N}_ -]{1,40})\}/gu;

function pieces(template: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of template.matchAll(FIELD)) {
    const index = m.index;
    if (index > at) out.push({ kind: 'text', text: template.slice(at, index) });
    out.push({ kind: 'field', name: (m[1] ?? '').trim() });
    at = index + m[0].length;
  }
  if (at < template.length) out.push({ kind: 'text', text: template.slice(at) });
  return out;
}

/** The fields a template asks for, each once, in order. */
export function templateFields(template: string): string[] {
  return [...new Set(pieces(template).flatMap((p) => (p.kind === 'field' ? [p.name] : [])))];
}

/** How a field is filled: as the template says, else typed in. */
export const fieldOf = (t: Pick<MessageTemplate, 'fields'>, name: string): MessageField =>
  t.fields[name] ?? { kind: 'text' };

/**
 * The message to show: the template with its typed fields filled in and its
 * timer fields live. Null (with the fields left empty) when a typed field
 * has nothing in it.
 */
export function fillMessage(
  t: MessageTemplate,
  values: Record<string, string>,
  timerName: (timerId: string) => string,
): { message: MessageItem; missing: [] } | { message: null; missing: string[] } {
  const missing = templateFields(t.template).filter(
    (name) => fieldOf(t, name).kind === 'text' && (values[name] ?? '').trim() === '',
  );
  if (missing.length > 0) return { message: null, missing };
  const parts: MessagePart[] = [];
  let text = '';
  for (const piece of pieces(t.template)) {
    if (piece.kind === 'text') {
      parts.push(piece);
      text += piece.text;
      continue;
    }
    const field = fieldOf(t, piece.name);
    if (field.kind === 'timer') {
      parts.push({ kind: 'timer', timerId: field.timerId });
      text += `[${timerName(field.timerId)}]`;
    } else {
      const value = (values[piece.name] ?? '').trim();
      parts.push({ kind: 'text', text: value });
      text += value;
    }
  }
  return { message: { id: messageItemId(t.id), text: text.slice(0, 500), parts }, missing: [] };
}

/** The id a template's message has on the messages layer (showing it again replaces it). */
export const messageItemId = (templateId: string): string => `message:${templateId}`;

// ---- checks for requests arriving over IPC ----------------------------------------

const fieldSchema: z.ZodType<MessageField> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text') }).strict(),
  z.object({ kind: z.literal('timer'), timerId: z.string().min(1).max(128) }).strict(),
]);

export const messageTemplateSchema: z.ZodType<MessageTemplateFields> = z
  .object({
    name: z.string().trim().min(1).max(80),
    template: z.string().trim().min(1).max(300),
    fields: z
      .record(z.string().min(1).max(40), fieldSchema)
      .refine((f) => Object.keys(f).length <= 20, 'too many fields'),
  })
  .strict();
