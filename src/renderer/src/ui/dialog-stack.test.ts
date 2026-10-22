import { describe, expect, it } from 'vitest';
import { DialogStack } from './dialog-stack';

/*
 * The open dialogs, innermost last (Dialog.tsx): only the innermost holds the keyboard. One on top (Keep these
 * screens?, Session 51, S3-5) stays innermost until it closes: a dialog opened meanwhile goes under it. Here the
 * page's elements are names, and an element is in a dialog when its name starts with the dialog's.
 */

interface Open {
  name: string;
  onTop: boolean;
  /** Where the keyboard goes back as it closes. */
  before: string | null;
}

const dialog = (name: string, before: string | null, onTop = false): Open => ({ name, before, onTop });
const inside = (d: Open) => (el: string) => el.startsWith(`${d.name} `);

describe('the open dialogs', () => {
  it('each one opened takes the keyboard, and gives it back to the one under it as it closes', () => {
    const stack = new DialogStack<string, Open>();
    const screens = dialog('Screens', 'Header Screens');
    const confirm = dialog('Cover the controls?', 'Screens Use this display');
    expect(stack.push(screens)).toBe(true);
    expect(stack.push(confirm)).toBe(true);
    expect(stack.innermost()).toBe(confirm);
    expect(stack.remove(confirm, inside(confirm))).toEqual({ held: true, next: screens });
    expect(stack.remove(screens, inside(screens))).toEqual({ held: true, next: undefined });
    expect(stack.innermost()).toBeUndefined();
  });

  it('one on top stays innermost: a dialog opened meanwhile goes under it and leaves it the keyboard', () => {
    const stack = new DialogStack<string, Open>();
    const wizard = dialog('Set Up Screens…', 'View menu');
    const question = dialog('Keep these screens?', 'Set Up Screens… Done', true);
    stack.push(wizard);
    expect(stack.push(question)).toBe(true);
    // Help › Guides… and the keys sheet, opened while it waits.
    const guides = dialog('Guides', 'Keep these screens? Keep');
    const keys = dialog('Keyboard shortcuts', 'Keep these screens? Keep');
    expect(stack.push(guides)).toBe(false);
    expect(stack.push(keys)).toBe(false);
    expect(stack.innermost()).toBe(question);
    // Each gives the keyboard back, as it closes, where it was before the question opened (never into it).
    expect([guides.before, keys.before]).toEqual(['Set Up Screens… Done', 'Set Up Screens… Done']);
    // One under it closing (by itself) leaves the keyboard with the question.
    expect(stack.remove(guides, inside(guides))).toEqual({ held: false, next: question });
    // Answered: the keyboard goes to the dialog opened meanwhile, then the wizard again.
    expect(stack.remove(question, inside(question))).toEqual({ held: true, next: keys });
    expect(stack.push(dialog('Appearance', 'Keyboard shortcuts Close'))).toBe(true);
  });

  it('an editor and its “Keep your changes?” closing together, the editor first: the keyboard goes back to what opened the editor', () => {
    const stack = new DialogStack<string, Open>();
    const editor = dialog('Slide editor', 'Slides Edit');
    const keepChanges = dialog('Keep your changes?', 'Slide editor Close');
    stack.push(editor);
    stack.push(keepChanges);
    // Throw away: the editor's effects end first (parent first), with the question still innermost.
    expect(stack.remove(editor, inside(editor))).toEqual({ held: false, next: keepChanges });
    // Where the question had the keyboard from is in the editor, gone: it takes the editor's own.
    expect(keepChanges.before).toBe('Slides Edit');
    expect(stack.remove(keepChanges, inside(keepChanges))).toEqual({ held: true, next: undefined });
    // Closed the other way round, each gives the keyboard back where it had it from.
    const again = dialog('Slide editor', 'Slides Edit');
    const asked = dialog('Keep your changes?', 'Slide editor Close');
    stack.push(again);
    stack.push(asked);
    expect(stack.remove(asked, inside(asked))).toEqual({ held: true, next: again });
    expect(asked.before).toBe('Slide editor Close');
    expect(stack.remove(again, inside(again))).toEqual({ held: true, next: undefined });
    expect(again.before).toBe('Slides Edit');
  });

  it('a second one on top goes over the first; closing one not open changes nothing', () => {
    const stack = new DialogStack<string, Open>();
    const first = dialog('Keep these screens?', 'Screens Use this display', true);
    const second = dialog('Turn the hall’s screens off?', 'Keep these screens? Keep', true);
    stack.push(first);
    expect(stack.push(second)).toBe(true);
    const guides = dialog('Guides', 'Turn the hall’s screens off? Cancel');
    expect(stack.push(guides)).toBe(false);
    // Under both: back where it was before the first opened.
    expect(guides.before).toBe('Screens Use this display');
    expect(stack.innermost()).toBe(second);
    const never = dialog('Never opened', null);
    expect(stack.remove(never, inside(never))).toEqual({ held: false, next: second });
    expect(stack.remove(second, inside(second))).toEqual({ held: true, next: first });
  });
});
