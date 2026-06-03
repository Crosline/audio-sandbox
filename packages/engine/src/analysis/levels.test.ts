import { describe, expect, it } from 'vitest';
import { amplitudeToDb, frameLevels, peakAmplitude, rmsAmplitude } from './levels.js';

describe('peakAmplitude', () => {
  it('finds the largest absolute value', () => {
    expect(peakAmplitude(Float32Array.from([0.2, -0.9, 0.5]))).toBeCloseTo(0.9, 6);
  });
  it('is 0 for an empty frame', () => {
    expect(peakAmplitude(new Float32Array(0))).toBe(0);
  });
});

describe('rmsAmplitude', () => {
  it('computes the root mean square', () => {
    // [1,-1,1,-1] -> mean of squares = 1 -> rms = 1
    expect(rmsAmplitude(Float32Array.from([1, -1, 1, -1]))).toBeCloseTo(1, 6);
  });
  it('a constant 0.5 signal has rms 0.5', () => {
    expect(rmsAmplitude(Float32Array.from([0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 6);
  });
  it('is 0 for an empty frame', () => {
    expect(rmsAmplitude(new Float32Array(0))).toBe(0);
  });
});

describe('amplitudeToDb', () => {
  it('maps full scale to 0 dB', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0, 6);
  });
  it('maps half amplitude to about -6 dB', () => {
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });
  it('clamps silence to the floor', () => {
    expect(amplitudeToDb(0)).toBe(-100);
    expect(amplitudeToDb(0, -120)).toBe(-120);
  });
});

describe('frameLevels', () => {
  it('reports peak and rms in linear and dBFS', () => {
    const r = frameLevels(Float32Array.from([1, -1, 1, -1]));
    expect(r.peak).toBeCloseTo(1, 6);
    expect(r.rms).toBeCloseTo(1, 6);
    expect(r.peakDb).toBeCloseTo(0, 6);
    expect(r.rmsDb).toBeCloseTo(0, 6);
  });
});
