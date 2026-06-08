/**
 * Tracks which ids have already been shown, so a one-shot entrance animation
 * fires exactly once per item — even though the transcript virtualizer remounts
 * row DOM as it scrolls. `isNew` is a pure query (safe to call during render);
 * call `remember` in an effect after commit to record what was shown.
 *
 * Seed the constructor with the ids present at mount so the initial transcript
 * does not animate; only ids that arrive later are "new".
 */
export class SeenSet {
  private seen: Set<string>;

  constructor(initial: Iterable<string> = []) {
    this.seen = new Set(initial);
  }

  isNew(id: string): boolean {
    return !this.seen.has(id);
  }

  remember(ids: Iterable<string>): void {
    for (const id of ids) this.seen.add(id);
  }
}
