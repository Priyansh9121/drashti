import { cutText } from './text';
import type { TextElement } from './model';
import type { EditDoc, EditSlide } from './slide-edit';
export interface PdfHandout {
  header: string;
  footer: string;
  watermark: string;
  numbers: boolean;
}
export const PDF_HANDOUT_PREFIX = 'PDF hand-out ';

/** These remain ordinary editable master text boxes; only the number box is resolved per page. */
export function pdfHandout(doc: EditDoc, values: PdfHandout): EditDoc {
  const width = doc.master?.pageSize?.width ?? doc.width;
  const height = doc.master?.pageSize?.height ?? doc.height;
  const fontSize = Math.max(8, height * 0.035);
  const margin = height * 0.025;
  const boxHeight = height * 0.07;
  const text = (key: string, words: string, y: number, watermark = false): TextElement => ({
    id: crypto.randomUUID(),
    name: `${PDF_HANDOUT_PREFIX}${key}`,
    kind: 'text',
    text: cutText(words, 200),
    lang: null,
    frame: { x: width * 0.04, y, width: width * 0.92, height: watermark ? height * 0.2 : boxHeight },
    style: {
      fontFamily: null,
      fontSize: watermark ? height * 0.1 : fontSize,
      fontWeight: 400,
      color: '#333333',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      shadow: false,
      shrinkToFit: true,
    },
    ...(watermark ? { opacity: 0.18, rotation: -30 } : {}),
  });
  const elements = [
    ...(values.header ? [text('header', values.header, margin)] : []),
    ...(values.footer
      ? [text('footer', values.footer, height - margin - boxHeight * (values.numbers ? 2 : 1))]
      : []),
    ...(values.watermark ? [text('watermark', values.watermark, height * 0.4, true)] : []),
    ...(values.numbers ? [text('numbers', '{page}', height - margin - boxHeight)] : []),
  ];
  const master: EditSlide = doc.master ?? {
    id: crypto.randomUUID(),
    label: 'Master',
    notes: '',
    background: null,
    darken: null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    elements: [],
    cues: [],
  };
  return {
    ...doc,
    master: {
      ...master,
      elements: [...master.elements.filter((e) => !e.name?.startsWith(PDF_HANDOUT_PREFIX)), ...elements],
    },
  };
}

export function hasPdfPageNumbers(master: EditSlide | null | undefined): boolean {
  return !!master?.elements.some(
    (element) => element.kind === 'text' && element.name === `${PDF_HANDOUT_PREFIX}numbers`,
  );
}

export function numberedPdfMaster(
  master: EditSlide | null | undefined,
  page?: number,
): EditSlide | null | undefined {
  if (!master || page === undefined || !hasPdfPageNumbers(master)) return master;
  return {
    ...master,
    elements: master.elements.map((element) =>
      element.kind === 'text' && element.name === `${PDF_HANDOUT_PREFIX}numbers`
        ? { ...element, text: String(page + 1), runs: undefined }
        : element,
    ),
  };
}
