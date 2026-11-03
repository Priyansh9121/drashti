import { describe, expect, it } from 'vitest';
import { isExpectedStudioDiscardClose } from '../../../tests/e2e/expected-studio-close';
import type { StudioDiscardState } from '../../../tests/e2e/expected-studio-close';

// The actual completed Windows Black failure, with no private data or timeout changes.
const selector = "getByTestId('keep-changes').getByRole('button', { name: 'Throw them away' })";
const message = `locator.click: Target page, context or browser has been closed\nCall log:\n  - waiting for ${selector}\n  - locator resolved to <button>Throw them away</button>\n  - performing click action\n`;
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

  it('rejects thrown strings instead of a Playwright Error', () => {
    expect(isExpectedStudioDiscardClose(message, closed)).toBe(false);
  });
});
