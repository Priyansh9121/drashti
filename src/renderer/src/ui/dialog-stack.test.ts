import { describe, expect, it } from 'vitest';
import { DialogStack } from './dialog-stack';

/*
 * The open dialogs, innermost last (Dialog.tsx): only the innermost holds the keyboard. One on top (Keep these
 * screens?, Session 51, S3-5) stays innermost until it closes: a dialog opened meanwhile goes under it.
 */

const dialog = (name: string, onTop = false) => ({ name, onTop });

describe('the open dialogs', () => {
  it('each one opened takes the keyboard, and gives it back to the one under it as it closes', () => {
    const stack = new DialogStack<ReturnType<typeof dialog>>();
    const screens = dialog('Screens');
    const confirm = dialog('Cover the controls?');
    expect(stack.push(screens)).toBe(true);
    expect(stack.push(confirm)).toBe(true);
    expect(stack.innermost()).toBe(confirm);
    expect(stack.remove(confirm)).toEqual({ held: true, next: screens });
    expect(stack.remove(screens)).toEqual({ held: true, next: undefined });
    expect(stack.innermost()).toBeUndefined();
  });

  it('one on top stays innermost: a dialog opened meanwhile goes under it and leaves it the keyboard', () => {
    const stack = new DialogStack<ReturnType<typeof dialog>>();
    const wizard = dialog('Set Up Screens…');
    const question = dialog('Keep these screens?', true);
    stack.push(wizard);
    expect(stack.push(question)).toBe(true);
    // Help › Guides… and the keys sheet, opened while it waits.
    const guides = dialog('Guides');
    const keys = dialog('Keyboard shortcuts');
    expect(stack.push(guides)).toBe(false);
    expect(stack.push(keys)).toBe(false);
    expect(stack.innermost()).toBe(question);
    // One under it closing (by itself) leaves the keyboard with the question.
    expect(stack.remove(guides)).toEqual({ held: false, next: question });
    // Answered: the keyboard goes to the dialog opened meanwhile, then the wizard again.
    expect(stack.remove(question)).toEqual({ held: true, next: keys });
    expect(stack.push(dialog('Appearance'))).toBe(true);
  });

  it('a second one on top goes over the first; closing one not open changes nothing', () => {
    const stack = new DialogStack<ReturnType<typeof dialog>>();
    const first = dialog('Keep these screens?', true);
    const second = dialog('Turn the hall’s screens off?', true);
    stack.push(first);
    expect(stack.push(second)).toBe(true);
    expect(stack.push(dialog('Guides'))).toBe(false);
    expect(stack.innermost()).toBe(second);
    expect(stack.remove(dialog('Never opened'))).toEqual({ held: false, next: second });
    expect(stack.remove(second)).toEqual({ held: true, next: first });
  });
});
