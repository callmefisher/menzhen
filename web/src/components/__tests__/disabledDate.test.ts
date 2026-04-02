import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { makeDisabledDate } from '../AppointmentModal';

const today = dayjs('2026-04-02'); // fixed reference date

describe('makeDisabledDate', () => {
  it('today is disabled (no same-day booking)', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    expect(fn(today)).toBe(true);
  });

  it('yesterday is disabled', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    expect(fn(today.subtract(1, 'day'))).toBe(true);
  });

  it('day at range_start boundary is enabled (weekdays=0)', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    expect(fn(today.add(1, 'day'))).toBe(false);
  });

  it('day at range_end boundary is enabled (weekdays=0)', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    expect(fn(today.add(30, 'day'))).toBe(false);
  });

  it('day after range_end is disabled', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    expect(fn(today.add(31, 'day'))).toBe(true);
  });

  it('day before range_start (but after today) is disabled', () => {
    // range_start=3 means first selectable day is today+3
    const fn = makeDisabledDate(today, 3, 30, 0);
    expect(fn(today.add(1, 'day'))).toBe(true);
    expect(fn(today.add(2, 'day'))).toBe(true);
    expect(fn(today.add(3, 'day'))).toBe(false);
  });

  it('weekdays=0 means no weekday restriction', () => {
    const fn = makeDisabledDate(today, 1, 30, 0);
    // 2026-04-03 is Friday, 2026-04-04 is Saturday, 2026-04-05 is Sunday
    expect(fn(today.add(1, 'day'))).toBe(false); // Fri
    expect(fn(today.add(2, 'day'))).toBe(false); // Sat
    expect(fn(today.add(3, 'day'))).toBe(false); // Sun
  });

  it('weekdays=42 (binary 0101010 = Mon+Wed+Fri) disables Tue/Thu/Sat/Sun', () => {
    // 42 = 0b0101010 → bit1=Mon, bit3=Wed, bit5=Fri
    const fn = makeDisabledDate(today, 1, 30, 42);
    // 2026-04-03 Fri (day()=5) → bit5 set → enabled
    expect(fn(dayjs('2026-04-03'))).toBe(false); // Fri ✓
    // 2026-04-06 Mon (day()=1) → bit1 set → enabled
    expect(fn(dayjs('2026-04-06'))).toBe(false); // Mon ✓
    // 2026-04-08 Wed (day()=3) → bit3 set → enabled
    expect(fn(dayjs('2026-04-08'))).toBe(false); // Wed ✓
    // 2026-04-04 Sat (day()=6) → bit6 not set → disabled
    expect(fn(dayjs('2026-04-04'))).toBe(true);  // Sat ✗
    // 2026-04-05 Sun (day()=0) → bit0 not set → disabled
    expect(fn(dayjs('2026-04-05'))).toBe(true);  // Sun ✗
    // 2026-04-07 Tue (day()=2) → bit2 not set → disabled
    expect(fn(dayjs('2026-04-07'))).toBe(true);  // Tue ✗
  });

  it('weekdays=127 (all 7 bits set) behaves like weekdays=0', () => {
    const fnAll = makeDisabledDate(today, 1, 30, 127);
    const fnNone = makeDisabledDate(today, 1, 30, 0);
    for (let i = 1; i <= 7; i++) {
      const d = today.add(i, 'day');
      expect(fnAll(d)).toBe(fnNone(d));
    }
  });
});
