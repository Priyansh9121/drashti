import type { ImportIssue } from '../../shared/import';

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  issues: ImportIssue[];
}

/** Guess UTF-16 without a byte-order mark: every other byte is zero in mostly-ASCII text. */
function utf16Guess(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (n < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZeros++;
    if (bytes[i + 1] === 0) oddZeros++;
  }
  const pairs = n / 2;
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return 'utf-16le';
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return 'utf-16be';
  return null;
}

/**
 * Decode a text file: a byte-order mark wins, then UTF-16 by its zero bytes,
 * then strict UTF-8. Anything else is read as Windows-1252 (what older
 * Windows editors wrote), with a warning in the report.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const issues: ImportIssue[] = [];
  let encoding: TextEncodingName;
  let body = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    body = bytes.subarray(3);
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    body = bytes.subarray(2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    body = bytes.subarray(2);
  } else {
    encoding = utf16Guess(bytes) ?? 'utf-8';
  }
  if (encoding === 'utf-8') {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding, issues };
    } catch {
      encoding = 'windows-1252';
      issues.push({
        severity: 'warning',
        code: 'not-utf8',
        message:
          'The file is not UTF-8, so it was read as Windows-1252 (Western European). Check accented letters. Gujarati or Hindi text needs a UTF-8 file.',
        fix: null,
      });
    }
  }
  return { text: new TextDecoder(encoding).decode(body), encoding, issues };
}
