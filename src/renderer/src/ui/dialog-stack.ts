/*
 * The open dialogs, innermost last (Dialog.tsx): only the innermost holds the keyboard. One on top (Keep these
 * screens?, Session 51, S3-5) stays innermost until it closes: a dialog opened meanwhile (Help › Guides…, the
 * keys sheet, anything the menu opens) goes under it and leaves it the keyboard, so Enter and Esc still answer
 * it; as it closes, the keyboard goes to the dialog under it. Each dialog knows where the keyboard goes back as
 * it closes (`before`, an element of the page: E).
 */

export interface Stacked<E> {
  /** Above every other dialog, with the keyboard, until it closes. */
  readonly onTop: boolean;
  /** Where the keyboard goes back as it closes: what had it as it opened, or null. */
  before: E | null;
}

export class DialogStack<E, T extends Stacked<E>> {
  private readonly open: T[] = [];

  /**
   * A dialog opens: true when it takes the keyboard. False when it went under one on top: that one keeps the
   * keyboard, and this one, as it closes, gives it back where it was before the first one on top opened.
   */
  push(dialog: T): boolean {
    const top = dialog.onTop ? -1 : this.open.findIndex((d) => d.onTop);
    const over = top < 0 ? undefined : this.open[top];
    if (!over) {
      this.open.push(dialog);
      return true;
    }
    dialog.before = over.before;
    this.open.splice(top, 0, dialog);
    return false;
  }

  /** The dialog holding the keyboard. */
  innermost(): T | undefined {
    return this.open.at(-1);
  }

  /**
   * A dialog closes: whether it held the keyboard, and the dialog that holds it now (it takes the keyboard back
   * only from the one that held it). A dialog opened from it (`inside`: an element is in the one closing) gives
   * the keyboard back, as it closes, where this one had it from: an editor and its "Keep your changes?" close
   * together, the editor's effects ending first (parent first) while the question is innermost, and where the
   * question had the keyboard from is in the editor, gone with it.
   */
  remove(dialog: T, inside: (element: E) => boolean): { held: boolean; next: T | undefined } {
    const at = this.open.lastIndexOf(dialog);
    if (at < 0) return { held: false, next: this.innermost() };
    const held = at === this.open.length - 1;
    this.open.splice(at, 1);
    for (const d of this.open) if (d.before !== null && inside(d.before)) d.before = dialog.before;
    return { held, next: this.innermost() };
  }
}
