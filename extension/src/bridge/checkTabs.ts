// a tab the website asked for is a check somebody just requested, so a platform paused for
// browsing is still read in it. the set is the background's, and it forgets a tab as it closes
export class CheckTabs {
  private readonly ids = new Set<number>();

  remember(tabId: number): void {
    this.ids.add(tabId);
  }

  forget(tabId: number): void {
    this.ids.delete(tabId);
  }

  has(tabId: number | undefined): boolean {
    return tabId !== undefined && this.ids.has(tabId);
  }

  get size(): number {
    return this.ids.size;
  }
}
