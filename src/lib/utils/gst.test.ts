import { describe, it, expect } from 'vitest';
import { normalizeGstin, isValidGstin } from './gst';

describe('normalizeGstin', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeGstin(' 22aaaaa0000a1z5 ')).toBe('22AAAAA0000A1Z5');
    expect(normalizeGstin('22 AAAAA 0000 A1Z5')).toBe('22AAAAA0000A1Z5');
  });
  it('handles null/undefined/empty', () => {
    expect(normalizeGstin(null)).toBe('');
    expect(normalizeGstin(undefined)).toBe('');
    expect(normalizeGstin('')).toBe('');
  });
});

describe('isValidGstin', () => {
  it('accepts well-formed GSTINs', () => {
    expect(isValidGstin('22AAAAA0000A1Z5')).toBe(true);
    expect(isValidGstin('09ABCDE1234F2Z6')).toBe(true);
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true); // normalized first
  });
  it('rejects malformed GSTINs', () => {
    expect(isValidGstin('')).toBe(false);
    expect(isValidGstin('22AAAAA0000A1X5')).toBe(false);  // 14th char must be Z
    expect(isValidGstin('2AAAAA0000A1Z5')).toBe(false);   // too short
    expect(isValidGstin('22AAAAA0000A1Z55')).toBe(false); // too long
    expect(isValidGstin('AAAAAA0000A1Z5X')).toBe(false);  // no state digits
    expect(isValidGstin('22AAAAA0000A0Z5')).toBe(false);  // entity code 0 invalid
  });
});
