import { describe, expect, it } from 'vitest';
import {
  FIRST_PDF_ONLY,
  FLOW_CHOSEN_IN_PRO,
  fileNameOf,
  flowDrop,
  isPdfPath,
  ONLY_A_PDF,
} from './sabha-flow-drop';

/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1): the one PDF taken as the running order, anything
 * else refused in words, of several files the first PDF only (said), and Simple Mode's panel, which never sets the flow
 * up. Placeholder file names only.
 */

const PRO = { setup: true };
const SIMPLE = { setup: false };

const mac = (name: string) => `/Users/placeholder/Desktop/${name}`;
const win = (name: string) => `C:\\Users\\placeholder\\Desktop\\${name}`;

describe('a file’s name and whether it is a PDF', () => {
  it('names the file from a Mac’s path and from Windows’', () => {
    expect(fileNameOf(mac('Placeholder order.pdf'))).toBe('Placeholder order.pdf');
    expect(fileNameOf(win('Placeholder order.pdf'))).toBe('Placeholder order.pdf');
    expect(fileNameOf('Placeholder order.pdf')).toBe('Placeholder order.pdf');
  });

  it('a PDF by its name, in any case; nothing else', () => {
    expect(isPdfPath(mac('Placeholder order.pdf'))).toBe(true);
    expect(isPdfPath(win('PLACEHOLDER ORDER.PDF'))).toBe(true);
    expect(isPdfPath(mac('Placeholder order.Pdf'))).toBe(true);
    expect(isPdfPath(mac('Placeholder notes.txt'))).toBe(false);
    expect(isPdfPath(mac('Placeholder order.pdf.txt'))).toBe(false);
    expect(isPdfPath(mac('Placeholder pdf'))).toBe(false);
    expect(isPdfPath(mac('Placeholder folder'))).toBe(false);
    expect(isPdfPath('')).toBe(false);
  });
});

describe('a drop on the Sabha flow panel', () => {
  it('one PDF: taken, nothing more to say', () => {
    expect(flowDrop([mac('Placeholder order.pdf')], PRO)).toEqual({
      take: true,
      file: mac('Placeholder order.pdf'),
      name: 'Placeholder order.pdf',
      note: null,
    });
    expect(flowDrop([win('Placeholder order.PDF')], PRO)).toEqual({
      take: true,
      file: win('Placeholder order.PDF'),
      name: 'Placeholder order.PDF',
      note: null,
    });
  });

  it('not a PDF: refused, saying which file and that only a PDF can be the running order', () => {
    expect(flowDrop([mac('Placeholder notes.txt')], PRO)).toEqual({
      take: false,
      message: `“Placeholder notes.txt” is not a PDF, so it was not used. ${ONLY_A_PDF}`,
    });
    expect(flowDrop([win('Placeholder folder')], PRO)).toEqual({
      take: false,
      message: `“Placeholder folder” is not a PDF, so it was not used. ${ONLY_A_PDF}`,
    });
    expect(ONLY_A_PDF).toBe('Only a PDF can be the running order.');
  });

  it('several files and none a PDF: refused, saying how many', () => {
    expect(
      flowDrop(
        [mac('Placeholder notes.txt'), mac('Placeholder clip.mp4'), mac('Placeholder deck.pptx')],
        PRO,
      ),
    ).toEqual({
      take: false,
      message: `3 files were not used: none of them is a PDF. ${ONLY_A_PDF}`,
    });
    expect(flowDrop([mac('Placeholder notes.txt'), mac('Placeholder clip.mp4')], PRO)).toEqual({
      take: false,
      message: `2 files were not used: none of them is a PDF. ${ONLY_A_PDF}`,
    });
  });

  it('a PDF among other files: the PDF taken, and it says the others were left', () => {
    expect(flowDrop([mac('Placeholder notes.txt'), mac('Placeholder order.pdf')], PRO)).toEqual({
      take: true,
      file: mac('Placeholder order.pdf'),
      name: 'Placeholder order.pdf',
      note: 'Only the PDF was used: the other file is not a PDF.',
    });
    expect(
      flowDrop(
        [mac('Placeholder order.pdf'), mac('Placeholder clip.mp4'), mac('Placeholder notes.txt')],
        PRO,
      ),
    ).toEqual({
      take: true,
      file: mac('Placeholder order.pdf'),
      name: 'Placeholder order.pdf',
      note: 'Only the PDF was used: the other 2 files are not PDFs.',
    });
  });

  it('several PDFs: the first taken, saying only the first was used', () => {
    expect(FIRST_PDF_ONLY).toBe('Only the first PDF was used.');
    expect(flowDrop([win('Placeholder one.pdf'), win('Placeholder two.pdf')], PRO)).toEqual({
      take: true,
      file: win('Placeholder one.pdf'),
      name: 'Placeholder one.pdf',
      note: FIRST_PDF_ONLY,
    });
    // The first PDF, wherever it comes among the files.
    expect(
      flowDrop(
        [mac('Placeholder notes.txt'), mac('Placeholder two.pdf'), mac('Placeholder one.pdf'), mac('x.mp4')],
        PRO,
      ),
    ).toEqual({
      take: true,
      file: mac('Placeholder two.pdf'),
      name: 'Placeholder two.pdf',
      note: FIRST_PDF_ONLY,
    });
  });

  it('nothing Drashti can tell the place of (a drag from a web page, say): refused, saying where to drop from', () => {
    expect(flowDrop([], PRO)).toEqual({
      take: false,
      message: 'Drop the PDF from the desktop or a USB drive: Drashti can’t tell where that one is kept.',
    });
  });

  it('Simple Mode’s panel takes none: the running order is chosen in Pro Mode', () => {
    expect(flowDrop([mac('Placeholder order.pdf')], SIMPLE)).toEqual({
      take: false,
      message: FLOW_CHOSEN_IN_PRO,
    });
    expect(flowDrop([mac('Placeholder notes.txt')], SIMPLE)).toEqual({
      take: false,
      message: FLOW_CHOSEN_IN_PRO,
    });
    expect(flowDrop([], SIMPLE)).toEqual({ take: false, message: FLOW_CHOSEN_IN_PRO });
    expect(FLOW_CHOSEN_IN_PRO).toBe(
      'The sabha’s running order is chosen in Pro Mode, with Choose PDF… in its Sabha flow.',
    );
  });
});
