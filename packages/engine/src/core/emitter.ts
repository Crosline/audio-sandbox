/**
 * A tiny, fully-typed event emitter — the engine's one communication primitive
 * with the outside world. Frameworks subscribe to these events and mirror them into
 * their own reactivity (Svelte runes, React `useSyncExternalStore`, etc.).
 *
 * `EventMap` maps each event name to its payload type, giving callers compile-time
 * safety on both `on(name, ...)` and `emit(name, payload)`.
 */
export type Listener<T> = (payload: T) => void;

export type EventMap = Record<string, unknown>;

export class Emitter<Events extends EventMap> {
  /** name -> set of listeners. A Set gives O(1) add/remove and dedupes handlers. */
  readonly #listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function — the same handle
   * frameworks expect (e.g. React's `useSyncExternalStore` subscribe contract).
   */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  /** Subscribe to an event, then automatically unsubscribe after the first emit. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /** Remove a previously-registered listener. No-op if it was never registered. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<unknown>);
    if (set.size === 0) this.#listeners.delete(event);
  }

  /**
   * Emit an event to all current listeners. Iterates a snapshot so that handlers
   * which subscribe/unsubscribe during dispatch don't disturb the active loop.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  /** Number of listeners for an event (handy in tests). */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /** Drop all listeners (for a single event, or every event). */
  clear<K extends keyof Events>(event?: K): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }
}
