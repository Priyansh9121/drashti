/**
 * tesseract.js's own worker code (it has no types of its own): the handlers its workers run (load, loadLanguage,
 * initialize, setParameters, recognize), driven here in the reading process itself (src/main/ocr/ocr-engine.ts).
 */
declare module 'tesseract.js/src/worker-script/index.js' {
  export interface TesseractPacket {
    jobId: string;
    workerId: string;
    action: string;
    payload?: unknown;
  }
  export interface TesseractAnswer {
    jobId: string;
    workerId: string;
    action: string;
    status: 'resolve' | 'reject' | 'progress';
    data: unknown;
  }
  export function dispatchHandlers(packet: TesseractPacket, send: (answer: TesseractAnswer) => void): void;
  export function setAdapter(adapter: Record<string, unknown>): void;
}
