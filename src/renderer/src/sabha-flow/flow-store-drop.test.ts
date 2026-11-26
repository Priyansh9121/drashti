import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SabhaFlow, SabhaFlowChoice } from '../../../shared/sabha-flow';
import { FIRST_PDF_ONLY, FLOW_CHOSEN_IN_PRO, ONLY_A_PDF } from '../../../shared/sabha-flow-drop';
import {
  cancelDroppedFlow,
  chooseFlow,
  confirmDroppedFlow,
  dropFlowFiles,
  STILL_READING,
  useFlow,
} from './flow-store';

/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1): taken as Choose PDF… takes its file (flow:choose,
 * now with the file, never Main's dialog); anything else refused in words without asking Main; with a flow already
 * there, "Replace the running order?" first, Cancel keeping it; of several files the first PDF, said once it is taken.
 * Main stood in for: what each choose was asked with, and its answer. Placeholder names only.
 */

const flow = (id: string, fileName: string): SabhaFlow => ({
  id,
  fileName,
  pageCount: 1,
  drawnPages: 1,
  status: 'read',
  lang: 'en',
  headers: ['No.', 'Program'],
  items: [{ no: '1', cells: ['Placeholder opening'] }],
});

const OLD = flow('flow-0001-old', 'Placeholder old order.pdf');
const NEW = flow('flow-0002-new', 'Placeholder order.pdf');

const at = (name: string) => `/Users/placeholder/Desktop/${name}`;

/** What Main's flow:choose was asked with, in order (undefined: no file, the dialog). */
let asked: (string | undefined)[] = [];
/** Main's next answer. */
let answer: () => Promise<SabhaFlowChoice | null> = () => Promise.resolve({ ok: true, flow: NEW });

/** Every answer given so far has been taken in. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  asked = [];
  answer = () => Promise.resolve({ ok: true, flow: NEW });
  vi.stubGlobal('window', {
    drashti: {
      flow: {
        choose: (file?: string) => {
          asked.push(file);
          return answer();
        },
      },
    },
  });
  useFlow.setState({
    flow: null,
    now: null,
    loaded: true,
    choosing: false,
    problem: null,
    note: null,
    dropped: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a drop with no flow yet', () => {
  it('one PDF: chosen as Choose PDF…’s file is, with nothing asked first and nothing more said', async () => {
    dropFlowFiles([at('Placeholder order.pdf')], true);
    await settled();
    expect(asked).toEqual([at('Placeholder order.pdf')]);
    expect(useFlow.getState()).toMatchObject({
      flow: NEW,
      now: null,
      problem: null,
      note: null,
      dropped: null,
    });
    expect(useFlow.getState().choosing).toBe(false);
  });

  it('not a PDF: refused in words, Main never asked', async () => {
    dropFlowFiles([at('Placeholder notes.txt')], true);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({
      flow: null,
      problem: `“Placeholder notes.txt” is not a PDF, so it was not used. ${ONLY_A_PDF}`,
      note: null,
      dropped: null,
    });
  });

  it('several PDFs: the first chosen, then it says only the first was used', async () => {
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    expect(asked).toEqual([at('Placeholder order.pdf')]);
    expect(useFlow.getState()).toMatchObject({ flow: NEW, problem: null, note: FIRST_PDF_ONLY });
  });

  it('a PDF among other files: the PDF chosen, then it says the others were left', async () => {
    dropFlowFiles([at('Placeholder notes.txt'), at('Placeholder order.pdf')], true);
    await settled();
    expect(asked).toEqual([at('Placeholder order.pdf')]);
    expect(useFlow.getState()).toMatchObject({
      flow: NEW,
      problem: null,
      note: 'Only the PDF was used: the other file is not a PDF.',
    });
  });

  it('refused by Main (not a PDF inside, say): its words, and nothing said of the files left', async () => {
    answer = () =>
      Promise.resolve({ ok: false, message: 'Placeholder words of Main’s refusal: choose another.' });
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    expect(useFlow.getState()).toMatchObject({
      flow: null,
      problem: 'Placeholder words of Main’s refusal: choose another.',
      note: null,
    });
  });

  it('Main’s ask failing on its way: said as Choose PDF…’s is', async () => {
    answer = () => Promise.reject(new Error('Placeholder failure'));
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    expect(useFlow.getState()).toMatchObject({
      flow: null,
      problem: 'Drashti couldn’t take that PDF. Try again, or choose another.',
      note: null,
      choosing: false,
    });
  });
});

describe('a drop with a flow there', () => {
  beforeEach(() => {
    useFlow.setState({ flow: OLD, now: 2 });
  });

  it('asks "Replace the running order?" first: nothing chosen until it is answered', async () => {
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({
      flow: OLD,
      now: 2,
      dropped: { file: at('Placeholder order.pdf'), name: 'Placeholder order.pdf', note: FIRST_PDF_ONLY },
    });
  });

  it('Replace: the dropped PDF chosen, Now starting again, and what was left said', async () => {
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    confirmDroppedFlow();
    expect(useFlow.getState().dropped).toBeNull();
    await settled();
    expect(asked).toEqual([at('Placeholder order.pdf')]);
    expect(useFlow.getState()).toMatchObject({ flow: NEW, now: null, problem: null, note: FIRST_PDF_ONLY });
  });

  it('Cancel: the flow and Now kept, Main never asked', async () => {
    dropFlowFiles([at('Placeholder order.pdf')], true);
    cancelDroppedFlow();
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({ flow: OLD, now: 2, dropped: null, problem: null, note: null });
    // Answered once: a second Replace does nothing.
    confirmDroppedFlow();
    await settled();
    expect(asked).toEqual([]);
  });

  it('not a PDF: refused at once, with nothing asked', async () => {
    dropFlowFiles([at('Placeholder clip.mp4'), at('Placeholder notes.txt')], true);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({
      flow: OLD,
      now: 2,
      dropped: null,
      problem: `2 files were not used: none of them is a PDF. ${ONLY_A_PDF}`,
    });
  });
});

describe('a drop the panel cannot take now', () => {
  it('while a PDF is still being read, or before the kept flow has been read: said, nothing asked', async () => {
    expect(STILL_READING).toBe(
      'Drashti is still reading the Sabha flow: drop the PDF again once it is shown.',
    );
    useFlow.setState({ choosing: true });
    dropFlowFiles([at('Placeholder order.pdf')], true);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({ problem: STILL_READING, dropped: null });
    useFlow.setState({ choosing: false, loaded: false, problem: null });
    dropFlowFiles([at('Placeholder order.pdf')], true);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({ problem: STILL_READING, dropped: null });
  });

  it('Simple Mode’s panel: the running order is chosen in Pro Mode, with nothing asked, a flow there or not', async () => {
    dropFlowFiles([at('Placeholder order.pdf')], false);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({ flow: null, problem: FLOW_CHOSEN_IN_PRO, dropped: null });
    useFlow.setState({ flow: OLD, now: 1, problem: null });
    dropFlowFiles([at('Placeholder order.pdf')], false);
    await settled();
    expect(asked).toEqual([]);
    expect(useFlow.getState()).toMatchObject({
      flow: OLD,
      now: 1,
      problem: FLOW_CHOSEN_IN_PRO,
      dropped: null,
    });
  });
});

describe('what a drop said, after', () => {
  it('goes with the next ask: Choose PDF… asks Main’s dialog, with no file', async () => {
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    expect(useFlow.getState().note).toBe(FIRST_PDF_ONLY);
    answer = () => Promise.resolve(null);
    await chooseFlow();
    expect(asked).toEqual([at('Placeholder order.pdf'), undefined]);
    expect(useFlow.getState()).toMatchObject({ flow: NEW, note: null, problem: null });
  });

  it('goes with a drop refused after it', async () => {
    dropFlowFiles([at('Placeholder order.pdf'), at('Placeholder two.pdf')], true);
    await settled();
    useFlow.setState({ flow: null });
    dropFlowFiles([at('Placeholder notes.txt')], true);
    expect(useFlow.getState().note).toBeNull();
  });
});
