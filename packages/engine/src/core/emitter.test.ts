import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter.js';

type TestEvents = {
  ping: number;
  msg: string;
};

describe('Emitter', () => {
  it('delivers payloads to subscribers', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    e.on('ping', fn);
    e.emit('ping', 42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it('supports multiple listeners on the same event', () => {
    const e = new Emitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    e.on('ping', a);
    e.on('ping', b);
    e.emit('ping', 1);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('isolates events by name', () => {
    const e = new Emitter<TestEvents>();
    const ping = vi.fn();
    const msg = vi.fn();
    e.on('ping', ping);
    e.on('msg', msg);
    e.emit('msg', 'hi');
    expect(ping).not.toHaveBeenCalled();
    expect(msg).toHaveBeenCalledTimes(1);
    expect(msg).toHaveBeenCalledWith('hi');
  });

  it('the returned unsubscribe stops further delivery', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    const off = e.on('ping', fn);
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(e.listenerCount('ping')).toBe(0);
  });

  it('once() fires exactly one time', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    e.once('ping', fn);
    e.emit('ping', 1);
    e.emit('ping', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('off() removes a specific listener only', () => {
    const e = new Emitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    e.on('ping', a);
    e.on('ping', b);
    e.off('ping', a);
    e.emit('ping', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('dedupes the same listener reference', () => {
    const e = new Emitter<TestEvents>();
    const fn = vi.fn();
    e.on('ping', fn);
    e.on('ping', fn);
    expect(e.listenerCount('ping')).toBe(1);
    e.emit('ping', 1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('unsubscribing during dispatch does not skip other listeners', () => {
    const e = new Emitter<TestEvents>();
    const calls: string[] = [];
    const offB = { current: (): void => {} };
    e.on('ping', () => {
      calls.push('a');
      offB.current(); // remove b mid-dispatch
    });
    offB.current = e.on('ping', () => calls.push('b'));
    e.on('ping', () => calls.push('c'));
    e.emit('ping', 1);
    // a runs, removes b, but the snapshot still delivers b and c this round
    expect(calls).toEqual(['a', 'b', 'c']);
    // next emit: b is gone
    calls.length = 0;
    e.emit('ping', 2);
    expect(calls).toEqual(['a', 'c']);
  });

  it('clear() with a name drops only that event; without a name drops all', () => {
    const e = new Emitter<TestEvents>();
    e.on('ping', vi.fn());
    e.on('msg', vi.fn());
    e.clear('ping');
    expect(e.listenerCount('ping')).toBe(0);
    expect(e.listenerCount('msg')).toBe(1);
    e.clear();
    expect(e.listenerCount('msg')).toBe(0);
  });
});
