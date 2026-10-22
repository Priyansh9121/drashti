/*
 * The open dialogs, innermost last (Dialog.tsx): only the innermost holds the keyboard. One on top (Keep these
 * screens?, Session 51, S3-5) stays innermost until it closes: a dialog opened meanwhile (Help › Guides…, the
 * keys sheet, anything the menu opens) goes under it and leaves it the keyboard, so Enter and Esc still answer
 * it; as it closes, the keyboard goes to the dialog under it.
 */

export interface Stacked {
  /** Above every other dialog, with the keyboard, until it closes. */
  readonly onTop: boolean;
}

export class DialogStack<T extends Stacked> {
  private readonly open: T[] = [];

  /** A dialog opens: true when it takes the keyboard, false when it went under one on top. */
  push(dialog: T): boolean {
    const top = dialog.onTop ? -1 : this.open.findIndex((d) => d.onTop);
    if (top < 0) {
      this.open.push(dialog);
      return true;
    }
    this.open.splice(top, 0, dialog);
    return false;
  }

  /** The dialog holding the keyboard. */
  innermost(): T | undefined {
    return this.open.at(-1);
  }

  /**
   * A dialog closes: whether it held the keyboard, and the dialog that holds it now (it takes the keyboard back
   * only from the one that held it).
   */
  remove(dialog: T): { held: boolean; next: T | undefined } {
    const at = this.open.lastIndexOf(dialog);
    const held = at >= 0 && at === this.open.length - 1;
    if (at >= 0) this.open.splice(at, 1);
    return { held, next: this.innermost() };
  }
}
