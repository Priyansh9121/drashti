/*
 * The presentations a library change names, gathered until Drashti tells the phones (QA24-PHONE-C,
 * a23-review-phonelows LOW-C). The library's 'presentations' hint carries them, so a phone reads again only those of
 * its playlist's rows (and its slides shown), never every PowerPoint and PDF row for a kirtan's words edited. A change
 * that cannot name its presentations (an import, media, a book) means any may have changed: the hint names none, and a
 * phone reads every row again, as before. Pure, so it is tested apart (library-changes.test.ts).
 */

/** At most this many named in one hint; more, and it names none (a phone reads its rows again, as for any). */
export const CHANGED_NAMED_MAX = 200;

export class ChangedPresentations {
  /** null: a change gathered that could not name them, so any may have changed. */
  private named: Set<string> | null = new Set();

  /** A change: the presentations it changed, or nothing when it cannot name them. */
  add(ids?: readonly string[]): void {
    if (ids === undefined || this.named === null) {
      this.named = null;
      return;
    }
    for (const id of ids) this.named.add(id);
    if (this.named.size > CHANGED_NAMED_MAX) this.named = null;
  }

  /** What the hint says, gathered afresh after: the presentations named, or undefined when any may have changed. */
  take(): string[] | undefined {
    const named = this.named;
    this.named = new Set();
    return named === null ? undefined : [...named];
  }
}
