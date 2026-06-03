import { describe, expect, it } from 'vitest';
import { volumeToGain } from './engine-context.js';

// EngineContext itself drives the Web Audio API and is verified through the app.
// The pure mapping it relies on is unit-tested here.
describe('volumeToGain', () => {
  it('maps 0..100 onto 0..1', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(50)).toBe(0.5);
    expect(volumeToGain(100)).toBe(1);
  });

  it('clamps out-of-range input', () => {
    expect(volumeToGain(-20)).toBe(0);
    expect(volumeToGain(150)).toBe(1);
  });
});
