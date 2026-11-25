import { z } from 'zod';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): the running order of a sabha, a PDF the operator chooses in the
 * operator window's "Sabha flow" panel. Drashti keeps its own copy in the data folder and reads the PDF's own text
 * layer (pdf.js, in the hidden pictures window; never OCR): each numbered item as a row in the PDF's own language,
 * the title, subtitle and total, and its pages as pictures for the PDF page view. The operator marks where the sabha
 * is (Now); the panel and a paired phone show Now and Next up. Read-only on the phone; never on an audience or stage
 * screen. Shown as text only, never spoken.
 *
 * The shared contract: the panel (operator window) and the phone remote build against these types.
 *
 * IPC (shared/ipc.ts `IPC.flow`; the operator window's bridge `window.drashti.flow`), every argument checked in Main:
 *   flow:get                      -> SabhaFlow | null              get()
 *   flow:now                      -> SabhaFlowState | null         now()
 *   flow:choose                   -> SabhaFlowChoice | null        choose()      (Main's file dialog; null: cancelled)
 *   flow:remove                   -> void                          remove()
 *   flow:set-now [flowId, now]    -> SabhaFlowNowResult            setNow(flowId, now)  (refused for a stale flowId)
 *   flow:page    [flowId, page]   -> Uint8Array | null             page(flowId, page)   (a PNG of the page, from 0)
 *   flow:changed (main -> operator) SabhaFlowSnapshot              onChanged(listener)
 * The pages are drawn once, when the PDF is chosen, by the app's own PDF page path (the hidden pictures window's
 * pdf.js), on white at their own shape, and kept beside Drashti's copy. The paired phone gets the same
 * SabhaFlowSnapshot and the same page PNGs through the remote's own routes.
 */

/** The PDF's language, by the script of its words ('mixed': more than one, none clearly most). */
export type SabhaFlowLang = 'en' | 'gu' | 'hi' | 'mixed';

/**
 * How reading went. 'read': items found. 'no-text': the PDF has no text layer (a scan, or pictures only): only its
 * pages can be shown. 'unreadable': it has text, but it comes out as private-use or replacement characters (fonts
 * without Unicode maps): only its pages can be shown. 'no-items': readable text, but no numbered items in it.
 */
export type SabhaFlowStatus = 'read' | 'no-text' | 'unreadable' | 'no-items';

/** One numbered item: its number as the PDF writes it ('1', '2', ...), and its cells. */
export interface SabhaFlowItem {
  no: string;
  /** Follow `headers` after the number's own column; a merged cell is repeated on each row it spans. */
  cells: string[];
}

export interface SabhaFlow {
  /** Changes whenever the PDF is replaced. */
  id: string;
  /** The operator's file name, shown in the panel. */
  fileName: string;
  pageCount: number;
  status: SabhaFlowStatus;
  lang: SabhaFlowLang;
  title?: string;
  subtitle?: string;
  /** E.g. ['No.', 'Program', 'Details', 'Duration', 'Presenter'], as the PDF has them ([] for a numbered list). */
  headers: string[];
  items: SabhaFlowItem[];
  total?: string;
}

/**
 * Where the sabha is (QA23-FLOW-2): `now` is an index into the flow's `items` (null: not started, or cleared).
 * Next up is the item after it. Remembered across restarts; reset to null when another PDF is chosen.
 */
export interface SabhaFlowState {
  flowId: string;
  now: number | null;
}

/** The current flow and where it is: what `flow:changed` carries, and what the paired phone gets. */
export interface SabhaFlowSnapshot {
  flow: SabhaFlow | null;
  /** Null exactly when `flow` is null; otherwise its `flowId` is `flow.id`. */
  state: SabhaFlowState | null;
}

/** "Choose PDF…" (flow:choose): the new flow (already the current one), or why not. Null: the dialog was cancelled. */
export type SabhaFlowChoice = { ok: true; flow: SabhaFlow } | { ok: false; message: string };

/** Marking Now (flow:set-now): the new state, or why not (a stale `flowId`, an index outside the items). */
export type SabhaFlowNowResult = { ok: true; state: SabhaFlowState } | { ok: false; message: string };

/** Limits on what a flow may hold (the reader keeps within them; the stored copy and the phone's data are checked). */
export const SABHA_FLOW_LIMITS = {
  /** The PDF Drashti will take (bytes). */
  maxPdfBytes: 50 * 1024 * 1024,
  /** Pages read and drawn. */
  maxPages: 20,
  maxItems: 300,
  maxColumns: 12,
  /** Characters in one cell, header, title, subtitle or total. */
  maxText: 1000,
  maxFileName: 255,
} as const;

const text = z.string().max(SABHA_FLOW_LIMITS.maxText);

export const sabhaFlowItemSchema: z.ZodType<SabhaFlowItem> = z.object({
  no: z.string().min(1).max(16),
  cells: z.array(text).max(SABHA_FLOW_LIMITS.maxColumns),
});

export const sabhaFlowSchema: z.ZodType<SabhaFlow> = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u),
  fileName: z.string().min(1).max(SABHA_FLOW_LIMITS.maxFileName),
  pageCount: z.number().int().min(0).max(100000),
  status: z.enum(['read', 'no-text', 'unreadable', 'no-items']),
  lang: z.enum(['en', 'gu', 'hi', 'mixed']),
  title: text.optional(),
  subtitle: text.optional(),
  headers: z.array(text).max(SABHA_FLOW_LIMITS.maxColumns),
  items: z.array(sabhaFlowItemSchema).max(SABHA_FLOW_LIMITS.maxItems),
  total: text.optional(),
});

export const sabhaFlowStateSchema: z.ZodType<SabhaFlowState> = z.object({
  flowId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u),
  now: z
    .number()
    .int()
    .min(0)
    .max(SABHA_FLOW_LIMITS.maxItems - 1)
    .nullable(),
});

/** A flow's `now` that is within its items (else null). */
export function nowWithin(flow: SabhaFlow, now: number | null): number | null {
  return now !== null && Number.isInteger(now) && now >= 0 && now < flow.items.length ? now : null;
}

/** The item after Now (the first item when nothing is Now yet); null after the last item, or with no items. */
export function nextUpIndex(flow: SabhaFlow, now: number | null): number | null {
  const at = nowWithin(flow, now);
  const next = at === null ? 0 : at + 1;
  return next < flow.items.length ? next : null;
}
