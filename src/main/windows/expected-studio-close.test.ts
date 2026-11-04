import { describe, expect, it } from 'vitest';
import { isExpectedStudioDiscardClose } from '../../../tests/e2e/expected-studio-close';
import type { StudioDiscardState } from '../../../tests/e2e/expected-studio-close';

// The actual completed Windows Black failure, with no private data or timeout changes.
const selector = "getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' })";
const message = `locator.click: Target page, context or browser has been closed\nCall log:\n  - waiting for ${selector}\n  - locator resolved to <button>Throw them away</button>\n  - performing click action\n`;
// The same ending as CI writes it (alpha.14's quick check on Windows, 4 Nov 2026, run 41717420786): Playwright puts each
// line of the call log in dim colour there, where colours are on, and not on this Mac, so the guard never matched.
const ESC = String.fromCharCode(27);
const onCi = (plain: string): string => {
  const [head = '', log = ''] = plain.split('Call log:\n');
  const lines = log.split('\n').map((line) => (line === '' ? line : `${ESC}[2m${line}${ESC}[22m`));
  return `${head}Call log:\n${lines.join('\n')}`;
};
const closed: StudioDiscardState = {
  studioClosed: true,
  studioCrashed: false,
  operatorClosed: false,
  operatorCrashed: false,
  appClosed: false,
  mainExited: false,
  studioIsClosed: true,
  studioStillListed: false,
  parentAlive: true,
};

describe('the expected Studio discard click boundary', () => {
  it('recognizes the recorded click ending after only its intended Studio closes', () => {
    expect(isExpectedStudioDiscardClose(new Error(message), closed)).toBe(true);
  });

  it.each([
    ['studioClosed', false],
    ['studioCrashed', true],
    ['operatorClosed', true],
    ['operatorCrashed', true],
    ['appClosed', true],
    ['mainExited', true],
    ['studioIsClosed', false],
    ['studioStillListed', true],
    ['parentAlive', false],
  ] as const)('rejects the close error when %s is %s', (field, value) => {
    expect(isExpectedStudioDiscardClose(new Error(message), { ...closed, [field]: value })).toBe(false);
  });

  it('rejects closure before Playwright reaches the actual input action', () => {
    expect(
      isExpectedStudioDiscardClose(new Error(message.replace('  - performing click action\n', '')), closed),
    ).toBe(false);
  });

  it('rejects a different target, even if the Studio happens to close', () => {
    expect(
      isExpectedStudioDiscardClose(
        new Error(message.replace(selector, "getByRole('button', { name: 'Save' })")),
        closed,
      ),
    ).toBe(false);
  });

  it('rejects timeouts and other errors after the Studio closes', () => {
    expect(
      isExpectedStudioDiscardClose(
        new Error(
          message.replace('Target page, context or browser has been closed', 'Timeout 30000ms exceeded'),
        ),
        closed,
      ),
    ).toBe(false);
  });

  it('recognizes the same ending as CI writes it, its call log in colour', () => {
    expect(isExpectedStudioDiscardClose(new Error(onCi(message)), closed)).toBe(true);
    expect(isExpectedStudioDiscardClose(new Error(onCi(message).replace(/\n/gu, '\r\n')), closed)).toBe(true);
  });

  it('still rejects, in colour, a different target, a timeout, or a close before the click', () => {
    const other = message.replace(selector, "getByRole('button', { name: 'Save' })");
    const timeout = message.replace(
      'Target page, context or browser has been closed',
      'Timeout 30000ms exceeded',
    );
    const early = message.replace('  - performing click action\n', '');
    for (const plain of [other, timeout, early])
      expect(isExpectedStudioDiscardClose(new Error(onCi(plain)), closed)).toBe(false);
  });

  it('rejects thrown strings instead of a Playwright Error', () => {
    expect(isExpectedStudioDiscardClose(message, closed)).toBe(false);
  });
});
