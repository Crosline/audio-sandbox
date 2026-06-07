/**
 * A generic, framework-agnostic bounded undo/redo stack.
 *
 * It stores **state snapshots** (not inverse operations): before an edit, the caller pushes
 * the *pre-edit* state; `undo` hands that snapshot back to restore, and stashes the supplied
 * *post-edit* (current) state on a redo stack so the edit can be replayed. The stack never
 * inspects the state `S` — it only sums each entry's caller-supplied `bytes` for the budget.
 *
 * Bounded by BOTH an entry count and a rough byte budget (per CLAUDE.md's undo/redo rule):
 * when a `push` takes the undo stack over either cap, the **oldest** entries are evicted.
 * Pure data structure — no `AudioContext`, no DOM — so it is unit-testable and reusable.
 */

export interface HistoryLimits {
  /** Maximum number of undo entries to retain. */
  maxEntries: number;
  /** Maximum total bytes across undo entries. */
  maxBytes: number;
}

/** One recorded snapshot: a labelled state plus its caller-estimated size. */
interface Entry<S> {
  label: string;
  state: S;
  bytes: number;
}

export class History<S> {
  readonly #limits: HistoryLimits;
  #undo: Entry<S>[] = [];
  #redo: Entry<S>[] = [];

  constructor(limits: HistoryLimits) {
    this.#limits = limits;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Record the pre-edit `state` (the snapshot to return to when undone). Clears the redo
   * stack — a fresh edit starts a new linear branch — then evicts oldest undo entries until
   * within both caps.
   */
  push(label: string, state: S, bytes: number): void {
    this.#redo = [];
    this.#undo.push({ label, state, bytes });
    this.#evict();
  }

  /**
   * Restore the most recent snapshot. `current`/`currentBytes` describe the live (post-edit)
   * state, which is stashed onto the redo stack. Returns the snapshot to apply, or `null`
   * when there is nothing to undo.
   */
  undo(current: S, currentBytes: number): { state: S; label: string } | null {
    const entry = this.#undo.pop();
    if (!entry) return null;
    this.#redo.push({ label: entry.label, state: current, bytes: currentBytes });
    return { state: entry.state, label: entry.label };
  }

  /**
   * Re-apply the most recently undone state. `current`/`currentBytes` describe the live
   * state, stashed back onto the undo stack. Returns the state to apply, or `null` when
   * there is nothing to redo.
   */
  redo(current: S, currentBytes: number): { state: S; label: string } | null {
    const entry = this.#redo.pop();
    if (!entry) return null;
    this.#undo.push({ label: entry.label, state: current, bytes: currentBytes });
    return { state: entry.state, label: entry.label };
  }

  /** Look at the top undo entry (state + label) without removing it, or null if empty. */
  peek(): { state: S; label: string } | null {
    const entry = this.#undo[this.#undo.length - 1];
    return entry ? { state: entry.state, label: entry.label } : null;
  }

  /** Look at the top redo entry (state + label) without removing it, or null if empty. */
  peekRedo(): { state: S; label: string } | null {
    const entry = this.#redo[this.#redo.length - 1];
    return entry ? { state: entry.state, label: entry.label } : null;
  }

  /** Drop all history. */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /** Evict oldest undo entries until within both the count and byte budgets. */
  #evict(): void {
    let total = this.#undo.reduce((sum, e) => sum + e.bytes, 0);
    while (
      this.#undo.length > this.#limits.maxEntries ||
      (total > this.#limits.maxBytes && this.#undo.length > 1)
    ) {
      const dropped = this.#undo.shift();
      if (!dropped) break;
      total -= dropped.bytes;
    }
  }
}
