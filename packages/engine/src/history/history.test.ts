import { describe, expect, it } from 'vitest';
import { History } from './history.js';

/**
 * The state `S` is just a string here — History is generic and never inspects it. `bytes`
 * is supplied per entry by the caller; the stack only sums it for the byte-budget cap.
 */
const LIMITS = { maxEntries: 50, maxBytes: 1_000_000 };

describe('History', () => {
  it('starts empty: nothing to undo or redo', () => {
    const h = new History<string>(LIMITS);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo('current', 1)).toBeNull();
    expect(h.redo('current', 1)).toBeNull();
  });

  it('push records a pre-edit snapshot that undo restores', () => {
    const h = new History<string>(LIMITS);
    // We are at state 'a'; we push 'a' before editing to 'b'.
    h.push('edit1', 'a', 1);
    expect(h.canUndo).toBe(true);
    // Undo from the post-edit state 'b' restores 'a'.
    const r = h.undo('b', 1);
    expect(r).toEqual({ state: 'a', label: 'edit1' });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('redo reverses an undo', () => {
    const h = new History<string>(LIMITS);
    h.push('edit1', 'a', 1);
    h.undo('b', 1); // now at 'a', redo holds 'b'
    const r = h.redo('a', 1);
    expect(r).toEqual({ state: 'b', label: 'edit1' });
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it('round-trips through multiple edits', () => {
    const h = new History<string>(LIMITS);
    h.push('e1', 'a', 1); // a -> b
    h.push('e2', 'b', 1); // b -> c
    expect(h.undo('c', 1)).toEqual({ state: 'b', label: 'e2' });
    expect(h.undo('b', 1)).toEqual({ state: 'a', label: 'e1' });
    expect(h.undo('a', 1)).toBeNull();
    expect(h.redo('a', 1)).toEqual({ state: 'b', label: 'e1' });
    expect(h.redo('b', 1)).toEqual({ state: 'c', label: 'e2' });
  });

  it('a new push clears the redo stack (linear history)', () => {
    const h = new History<string>(LIMITS);
    h.push('e1', 'a', 1);
    h.undo('b', 1); // redo now holds 'b'
    expect(h.canRedo).toBe(true);
    h.push('e2', 'a', 1); // a new branch
    expect(h.canRedo).toBe(false);
    expect(h.redo('x', 1)).toBeNull();
  });

  it('evicts the oldest entries when over maxEntries', () => {
    const h = new History<string>({ maxEntries: 2, maxBytes: 1_000_000 });
    h.push('e1', 's1', 1);
    h.push('e2', 's2', 1);
    h.push('e3', 's3', 1); // over the cap — 'e1' evicted
    expect(h.undo('cur', 1)).toEqual({ state: 's3', label: 'e3' });
    expect(h.undo('s3', 1)).toEqual({ state: 's2', label: 'e2' });
    expect(h.undo('s2', 1)).toBeNull(); // 'e1' is gone
  });

  it('evicts the oldest entries when over maxBytes', () => {
    const h = new History<string>({ maxEntries: 50, maxBytes: 100 });
    h.push('e1', 's1', 60);
    h.push('e2', 's2', 60); // total 120 > 100 — 'e1' evicted
    expect(h.undo('cur', 10)).toEqual({ state: 's2', label: 'e2' });
    expect(h.undo('s2', 10)).toBeNull();
  });

  it('clear empties both stacks', () => {
    const h = new History<string>(LIMITS);
    h.push('e1', 'a', 1);
    h.undo('b', 1);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
