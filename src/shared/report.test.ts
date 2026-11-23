import { describe, expect, it } from 'vitest';
import { core } from '../../tests/access-core';
import { formatBytes } from './format';
import {
  draftProblem,
  readReportDraft,
  REPORT_LIMITS,
  reportCleanLines,
  reportComputerLine,
  reportFileName,
  reportLetters,
  reportMailText,
  reportReference,
  reportSubject,
  type ReportMailParts,
} from './report';

/*
 * Help › Report a Problem… (x49): Drashti's Review shows exactly what the admin's email will say (the owner's
 * show-before-send rule, Q60-38). The access list makes that email (access-list/core.js, which cannot import this
 * file); Drashti makes the Review with its own copy of the same rules: here they are kept equal on the same reports.
 * Placeholder words only.
 */

const MAC = { name: 'Placeholder Mac', version: '1.0.0-alpha.20', platform: 'darwin' };
const NODE = { name: 'Placeholder Node', version: '1.0.0-alpha.20', platform: 'win32' };

const PARTS: ReportMailParts[] = [
  {
    reference: 'R-7K3P-Q2XM',
    gmail: 'placeholder.user@example.com',
    computer: 'Placeholder Mac (Drashti 1.0.0-alpha.20, Mac), in Pro Mode',
    written: '20 Nov 2026, 19:42',
    received: 'when it arrives',
    features: [
      {
        chapter: 'LIVE, Back and Next',
        name: 'The time bar',
        what: 'Placeholder words:\nthe time bar stops.',
        expected: 'Placeholder: it runs on.',
      },
      { chapter: '', name: 'Something else', what: 'Placeholder ક્ષ words.' },
    ],
    notice: 'Placeholder notice words.',
    errors: [
      '2026-11-20T08:41:00.000Z [error] Placeholder error line',
      '2026-11-20T08:41:01.000Z [warn] Another',
    ],
    files: [
      { name: 'Drashti diagnostics 2026-11-20 19-42.txt', bytes: 612_345 },
      { name: 'Drashti window 2026-11-20 19-42.png', bytes: 284_001 },
    ],
    kept: [{ name: '0f1e2d3c-placeholder.dmp', bytes: 4 * 1024 * 1024 }],
    owner: false,
  },
  {
    reference: 'R-0000-0000',
    gmail: 'owner.placeholder@example.com',
    computer: 'the node Placeholder Node (Drashti 1.0.0-alpha.20, Windows), through Main Placeholder Mac',
    written: '20 Nov 2026, 19:42',
    received: '20 Nov 2026, 19:43',
    features: [{ chapter: 'Stream', name: 'Going live', what: 'Placeholder.' }],
    files: [],
    owner: true,
  },
];

describe('Drashti’s Review and the access list’s email', () => {
  it('say the same text for the same report', () => {
    for (const parts of PARTS) {
      const text = reportMailText(parts);
      expect(text).toBe(core.reportMailText(parts));
      expect(text.startsWith(`Drashti problem ${parts.reference}\n`)).toBe(true);
    }
  });

  it('give the same reference, subject, sizes and computer line', () => {
    for (let i = 0; i < 20; i++) {
      const id = Array.from({ length: 32 }, () =>
        '0123456789abcdef'.charAt(Math.floor(Math.random() * 16)),
      ).join('');
      expect(reportReference(id)).toBe(core.reportReference(id));
    }
    expect(reportReference('f'.repeat(32))).toBe('R-ZZZZ-ZZZZ');
    const names = ['The time bar', 'Markers', 'Oops', 'Next and Back', 'Black-out and the Wallpaper'];
    const long = 'Placeholder feature with a long name '.repeat(3).trim();
    for (const list of [names.slice(0, 1), names.slice(0, 3), names, [long, `${long} 2`, `${long} 3`]])
      expect(reportSubject(list, 'R-7K3P-Q2XM')).toBe(core.reportSubject(list, 'R-7K3P-Q2XM'));
    for (const n of [0, 52, 1023, 1024, 612_345, 7 * 1024 * 1024, 3 * 1024 ** 3])
      expect(core.sizeText(n)).toBe(formatBytes(n));
    for (const [from, node] of [
      ['pro', null],
      ['simple', null],
      ['node', NODE],
    ] as const)
      expect(reportComputerLine(MAC, from, node)).toBe(core.reportComputerLine(MAC, from, node));
  });

  it('clean the words the same way, their line breaks kept, and count their letters as people see them', () => {
    for (const sample of [
      '  Placeholder\u0007 words\r\n\r\n\r\n\r\nsecond\u200b line\t\there  \n',
      ' a\u0000b \r\nc\u2028d ',
      'ક્ષ\u202e Placeholder 😀',
      '',
      '\n\n\n',
    ])
      expect(reportCleanLines(sample)).toBe(core.cleanLines(sample));
    expect(reportLetters('ક્ષ😀a')).toBe(3);
  });

  it('names its two files as Save Diagnostics names its own, by the time they were made', () => {
    expect(reportFileName('diagnostics', '2026-11-20 19-42')).toBe(
      'Drashti diagnostics 2026-11-20 19-42.txt',
    );
    expect(reportFileName('picture', '2026-11-20 19-42')).toBe('Drashti window 2026-11-20 19-42.png');
  });
});

describe('what the window lets go to Review', () => {
  const words = (what: string, expected = '') => ({ name: 'The time bar', what, expected });

  it('needs a feature, and what went wrong with each, within the list’s limits (Q60-42)', () => {
    expect(draftProblem({ features: [] })).toBe('Choose where the problem is.');
    expect(draftProblem({ features: [words('   ')] })).toBe('Say what went wrong with The time bar.');
    expect(draftProblem({ features: [words('Placeholder.')] })).toBeNull();
    expect(draftProblem({ features: [words('x'.repeat(REPORT_LIMITS.whatLetters + 1))] })).toBe(
      'The time bar: at most 2,000 letters for what went wrong.',
    );
    expect(draftProblem({ features: [words('x', 'y'.repeat(REPORT_LIMITS.expectedLetters + 1))] })).toBe(
      'The time bar: at most 1,000 letters for what you expected.',
    );
    expect(draftProblem({ features: [words('ક'.repeat(2000), 'ખ'.repeat(1000))] })).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({
      name: `Placeholder ${String(i)}`,
      what: 'x',
      expected: '',
    }));
    expect(draftProblem({ features: nine })).toBe(
      'At most 8 features in one report: send another for the rest.',
    );
  });
});

describe('the log of a chosen period in a report (alpha.21, logs for 100+ installs (c))', () => {
  const draft = {
    features: [{ id: 'f', chapter: 'Placeholder', name: 'The time bar', what: 'Placeholder.', expected: '' }],
    notice: null,
    diagnostics: true,
    crashFiles: false,
    picture: false,
  };

  it('takes the period the window chose: Today, Yesterday, the last 7 days or one day; Today when none is said', () => {
    for (const period of ['today', 'yesterday', 'last-7-days', '2026-11-20'] as const)
      expect(readReportDraft({ ...draft, period })?.period, period).toBe(period);
    expect(readReportDraft(draft)?.period).toBe('today');
  });

  it('refuses any other', () => {
    for (const period of ['tomorrow', '2026-02-30', '', 7, null])
      expect(readReportDraft({ ...draft, period }), String(period)).toBeNull();
  });
});
