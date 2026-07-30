import { describe, it, expect } from 'vitest';
import { normalizeAssetDate } from './dates';

/**
 * Every case below is drawn from the client's real workbook,
 * "Fixed assets Register SCPL (1).xlsx", which failed to import with
 * `22009 invalid_time_zone_displacement_value` — losing all 210 assets.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe('the cell that broke the import', () => {
  it('rejects a year typo instead of emitting a malformed date', () => {
    // "03.07.20223" (2022 mistyped) used to reach new Date(), whose year fell
    // outside 0000-9999, so toISOString() switched to expanded format and
    // slice(0,10) produced "+020223-03". Postgres read the leading "+" as a
    // timezone displacement and rejected the entire batch.
    expect(normalizeAssetDate('03.07.20223')).toBeNull();
  });

  it('never returns a string starting with a sign, whatever the year', () => {
    for (const s of ['99999-1-1', '275760-09-13', 'Dec 31, 99999', '1/1/275760', '-2011-01-01']) {
      const out = normalizeAssetDate(s);
      expect(out === null || ISO.test(out)).toBe(true);
      if (out) expect(out.startsWith('+') || out.startsWith('-')).toBe(false);
    }
  });

  it('one bad cell cannot poison the others', () => {
    const col = ['29.07.2017', '03.07.20223', '14.06.2023'];
    const out = col.map(normalizeAssetDate);
    expect(out).toEqual(['2017-07-29', null, '2023-06-14']);
  });
});

describe('day-first dates — the Indian convention these workbooks use', () => {
  it('reads dd.mm.yyyy as day first', () => {
    // JavaScript reads dots as MONTH-first, so this silently became 11 May.
    expect(normalizeAssetDate('05.12.2011')).toBe('2011-12-05');
    expect(normalizeAssetDate('01.02.2021')).toBe('2021-02-01');
  });

  it('accepts a day above 12, which month-first parsing rejected outright', () => {
    // 58 of 79 dated rows in the client file were being dropped by this.
    expect(normalizeAssetDate('29.07.2017')).toBe('2017-07-29');
    expect(normalizeAssetDate('31.08.2013')).toBe('2013-08-31');
    expect(normalizeAssetDate('30.09.2013')).toBe('2013-09-30');
  });

  it('handles the other separators the same way', () => {
    expect(normalizeAssetDate('29-07-2017')).toBe('2017-07-29');
    expect(normalizeAssetDate('29/07/2017')).toBe('2017-07-29');
  });

  it('swaps when only the SECOND component can be a day', () => {
    // A month-first row inside an otherwise day-first sheet is recovered
    // rather than discarded.
    expect(normalizeAssetDate('07.29.2017')).toBe('2017-07-29');
  });

  it('expands a two-digit year around the 1970 pivot', () => {
    expect(normalizeAssetDate('1/1/24')).toBe('2024-01-01');
    expect(normalizeAssetDate('1/1/98')).toBe('1998-01-01');
  });

  it('takes the first date when a cell holds several', () => {
    // A real cell: "21.10.2013   21.10.2013   03.12.2013"
    expect(normalizeAssetDate('21.10.2013                 21.10.2013            03.12.2013'))
      .toBe('2013-10-21');
  });

  it('rejects an impossible calendar day rather than rolling it over', () => {
    // new Date('2013-02-31') rolls to 3 March; recording that as a purchase
    // date would be inventing a fact.
    expect(normalizeAssetDate('31.02.2013')).toBeNull();
    expect(normalizeAssetDate('32.01.2013')).toBeNull();
  });
});

describe('bare years and Excel serials', () => {
  it('treats a four-digit year as a year, not an Excel serial', () => {
    // Serial 2011 is 3 July 1905 — a plausible-looking date that is simply
    // wrong, and the kind of error nobody notices for months.
    expect(normalizeAssetDate('2011')).toBe('2011-01-01');
    expect(normalizeAssetDate('2023')).toBe('2023-01-01');
  });

  it('still reads a genuine Excel serial', () => {
    expect(normalizeAssetDate('45000')).toBe('2023-03-15');
  });

  it('rejects a four-digit number that is not a plausible year', () => {
    expect(normalizeAssetDate('1000')).toBeNull();
    expect(normalizeAssetDate('9999')).toBeNull();
  });
});

describe('never throws, never emits anything but a clean date or null', () => {
  it('handles empty, junk and non-string input', () => {
    for (const v of ['', '   ', 'NA', '—', 'n/a', '-', undefined, null, {}, [], NaN]) {
      const out = normalizeAssetDate(v as unknown);
      expect(out === null || ISO.test(out)).toBe(true);
    }
  });

  it('keeps every result inside a plausible range', () => {
    for (const s of ['01.01.1899', '01.01.2101', '1899', '2101']) {
      expect(normalizeAssetDate(s)).toBeNull();
    }
    expect(normalizeAssetDate('01.01.1900')).toBe('1900-01-01');
    expect(normalizeAssetDate('01.01.2100')).toBe('2100-01-01');
  });
});
