import { describe, it, expect } from 'vitest';
import { parsePressureToKg, parseBatchTimestamp } from './nvidiaOcr';

describe('parsePressureToKg', () => {
  it('returns null for empty/nullish input', () => {
    expect(parsePressureToKg(null)).toBeNull();
    expect(parsePressureToKg('')).toBeNull();
    expect(parsePressureToKg('abc')).toBeNull();
  });

  it('reads a plain number as kg', () => {
    expect(parsePressureToKg('2.5')).toBe(2.5);
    expect(parsePressureToKg('5 kg')).toBe(5);
  });

  it('converts grams to kg', () => {
    expect(parsePressureToKg('500 g')).toBe(0.5);
    expect(parsePressureToKg('250g')).toBe(0.25);
  });

  it('treats a "k" suffix as kg (not grams)', () => {
    expect(parsePressureToKg('3k')).toBe(3);
  });
});

describe('parseBatchTimestamp', () => {
  // The function builds a LOCAL Date, so round-trip via getHours() (also local)
  // is timezone-stable; asserting the raw ISO string would not be.
  function parts(date: string, time: string) {
    const d = new Date(parseBatchTimestamp(date, time));
    return { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate(), h: d.getHours(), min: d.getMinutes() };
  }

  it('parses dd/mm/yy + "10 PM" into the right local components', () => {
    expect(parts('22/02/26', '10 PM')).toEqual({ y: 2026, mo: 1, day: 22, h: 22, min: 0 });
  });

  it('handles 12 AM as midnight and 12 PM as noon', () => {
    expect(parts('01/01/26', '12 AM').h).toBe(0);
    expect(parts('01/01/26', '12 PM').h).toBe(12);
  });

  it('reads minutes from "6:30 AM"', () => {
    const p = parts('15/03/26', '6:30 AM');
    expect(p.h).toBe(6);
    expect(p.min).toBe(30);
  });

  it('falls back to a valid timestamp on garbage input (does not throw)', () => {
    const iso = parseBatchTimestamp('garbage', 'nonsense');
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
  });
});
