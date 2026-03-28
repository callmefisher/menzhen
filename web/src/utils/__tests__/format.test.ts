import { describe, it, expect } from 'vitest';
import { fmtTotal, chunkToRows, formatRoom } from '../format';

describe('fmtTotal', () => {
  it('returns integer string when result is whole number', () => {
    expect(fmtTotal(42)).toBe('42');
    expect(fmtTotal(10 * 7)).toBe('70');
  });

  it('returns 1 decimal when result has fractional part', () => {
    expect(fmtTotal(37.800000000000004)).toBe('37.8');
    expect(fmtTotal(25.2)).toBe('25.2');
    expect(fmtTotal(12.6)).toBe('12.6');
  });

  it('handles zero', () => {
    expect(fmtTotal(0)).toBe('0');
  });

  it('rounds .X5 up to .X+1', () => {
    // 0.05 * 7 = 0.35000000000000003 → rounds to 0.4
    expect(fmtTotal(0.35000000000000003)).toBe('0.4');
  });

  it('strips trailing .0', () => {
    expect(fmtTotal(5.0)).toBe('5');
    expect(fmtTotal(100.0)).toBe('100');
  });
});

describe('chunkToRows', () => {
  it('returns empty array for empty input', () => {
    expect(chunkToRows([], 10)).toEqual([]);
  });

  it('returns single row single column for items < chunkSize', () => {
    const items = [1, 2, 3];
    expect(chunkToRows(items, 10)).toEqual([[[1, 2, 3]]]);
  });

  it('returns single row single column for exactly chunkSize items', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const result = chunkToRows(items, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0]).toHaveLength(10);
  });

  it('returns single row two columns for chunkSize+1 items', () => {
    const items = Array.from({ length: 11 }, (_, i) => i);
    const result = chunkToRows(items, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0]).toHaveLength(10);
    expect(result[0][1]).toHaveLength(1);
  });

  it('returns single row two columns for 2*chunkSize items', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const result = chunkToRows(items, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0][0]).toHaveLength(10);
    expect(result[0][1]).toHaveLength(10);
  });

  it('returns two rows for 2*chunkSize+1 items', () => {
    const items = Array.from({ length: 21 }, (_, i) => i);
    const result = chunkToRows(items, 10);
    expect(result).toHaveLength(2);
    // Row 1: two columns of 10
    expect(result[0]).toHaveLength(2);
    expect(result[0][0]).toHaveLength(10);
    expect(result[0][1]).toHaveLength(10);
    // Row 2: single column of 1
    expect(result[1]).toHaveLength(1);
    expect(result[1][0]).toHaveLength(1);
    expect(result[1][0][0]).toBe(20);
  });

  it('works with chunkSize=5 for patents', () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    const result = chunkToRows(items, 5);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toEqual([0, 1, 2, 3, 4]);
    expect(result[0][1]).toEqual([5, 6, 7]);
  });

  it('handles single item', () => {
    expect(chunkToRows(['a'], 10)).toEqual([[['a']]]);
  });
});

describe('formatRoom', () => {
  describe('empty or undefined input', () => {
    it('returns "诊室" for undefined', () => {
      expect(formatRoom(undefined)).toBe('诊室');
    });

    it('returns "诊室" for empty string', () => {
      expect(formatRoom('')).toBe('诊室');
    });

    it('returns "诊室" for whitespace-only string', () => {
      expect(formatRoom('   ')).toBe('诊室');
    });
  });

  describe('pure number input', () => {
    it('prepends "诊室" for single digit', () => {
      expect(formatRoom('1')).toBe('诊室1');
    });

    it('prepends "诊室" for multi-digit number', () => {
      expect(formatRoom('123')).toBe('诊室123');
    });

    it('handles zero', () => {
      expect(formatRoom('0')).toBe('诊室0');
    });

    it('handles number with leading zeros', () => {
      expect(formatRoom('001')).toBe('诊室001');
    });

    it('trims whitespace before checking', () => {
      expect(formatRoom(' 123 ')).toBe('诊室123');
    });
  });

  describe('already contains "诊室"', () => {
    it('returns as-is when starts with "诊室"', () => {
      expect(formatRoom('诊室1')).toBe('诊室1');
    });

    it('returns as-is when ends with "诊室"', () => {
      expect(formatRoom('1诊室')).toBe('1诊室');
    });

    it('returns as-is when contains "诊室" in middle', () => {
      expect(formatRoom('第一诊室A')).toBe('第一诊室A');
    });

    it('trims whitespace', () => {
      expect(formatRoom(' 诊室1 ')).toBe('诊室1');
    });
  });

  describe('other room names', () => {
    it('returns original name for VIP room', () => {
      expect(formatRoom('VIP室')).toBe('VIP室');
    });

    it('returns original name for special room', () => {
      expect(formatRoom('专家门诊')).toBe('专家门诊');
    });

    it('trims whitespace from room name', () => {
      expect(formatRoom(' VIP室 ')).toBe('VIP室');
    });
  });

  describe('edge cases', () => {
    it('handles alphanumeric room names', () => {
      expect(formatRoom('A101')).toBe('A101');
    });

    it('handles room names with special characters', () => {
      expect(formatRoom('1-诊室')).toBe('1-诊室');
    });

    it('handles Chinese number that is not pure digit', () => {
      expect(formatRoom('一诊室')).toBe('一诊室');
    });
  });
});
