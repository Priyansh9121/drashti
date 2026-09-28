import { TextDecoder } from 'node:util';

/*
 * RTF code pages: which TextDecoder label reads the bytes of a \'hh escape.
 * A font's \fcharset picks its code page; \ansicpg sets the document default.
 */

const CODE_PAGES: Record<number, string> = {
  437: 'ibm866', // no DOS 437 decoder; 866 shares the ASCII half, which is what these files use
  850: 'ibm866',
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  10000: 'macintosh',
  65001: 'utf-8',
};

/** \fcharsetN -> Windows code page. 0 (ANSI) and 1 (default) follow the document's \ansicpg. */
const CHARSETS: Record<number, number> = {
  77: 10000,
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
};

export function codePageForCharset(charset: number): number | null {
  return CHARSETS[charset] ?? null;
}

const decoders = new Map<number, TextDecoder>();

/** A decoder for a code page; unknown pages read as Windows-1252. */
export function decoderFor(codePage: number): TextDecoder {
  let decoder = decoders.get(codePage);
  if (!decoder) {
    try {
      decoder = new TextDecoder(CODE_PAGES[codePage] ?? 'windows-1252');
    } catch {
      decoder = new TextDecoder('windows-1252');
    }
    decoders.set(codePage, decoder);
  }
  return decoder;
}
