import { describe, it, expect } from 'vitest';
import { aggregateForCharts } from '../StatsDashboard';
import type { QuickRange } from '../StatsDashboard';
import type { DailyTrendItem } from '../../../api/statistics';

function makeItem(date: string, revenue = 100): DailyTrendItem {
  return {
    date,
    revenue,
    consultation_fee: revenue * 0.3,
    drug_fee: revenue * 0.7,
    record_count: 1,
    new_patient_count: 1,
    returning_patient_count: 0,
  };
}

describe('aggregateForCharts', () => {
  describe('daily modes (today/week/month/custom)', () => {
    const dailyModes: QuickRange[] = ['today', 'week', 'month', 'custom'];

    dailyModes.forEach((mode) => {
      it(`${mode}: formats date as MM-DD`, () => {
        const data = [makeItem('2026-03-01'), makeItem('2026-03-15')];
        const result = aggregateForCharts(data, mode);
        expect(result).toHaveLength(2);
        expect(result[0].date).toBe('03-01');
        expect(result[1].date).toBe('03-15');
      });
    });

    it('preserves all numeric fields unchanged', () => {
      const data = [makeItem('2026-03-10', 500)];
      const result = aggregateForCharts(data, 'month');
      expect(result[0].revenue).toBe(500);
      expect(result[0].consultation_fee).toBe(150);
      expect(result[0].drug_fee).toBe(350);
      expect(result[0].record_count).toBe(1);
    });

    it('handles empty array', () => {
      expect(aggregateForCharts([], 'month')).toEqual([]);
    });
  });

  describe('quarter mode: aggregates by week', () => {
    it('groups days in same week together', () => {
      // 2026-03-09 (Mon) to 2026-03-15 (Sun) are the same week
      const data = [
        makeItem('2026-03-09', 100),
        makeItem('2026-03-10', 200),
        makeItem('2026-03-11', 300),
      ];
      const result = aggregateForCharts(data, 'quarter');
      expect(result).toHaveLength(1);
      expect(result[0].revenue).toBe(600);
      expect(result[0].record_count).toBe(3);
      expect(result[0].new_patient_count).toBe(3);
    });

    it('separates different weeks', () => {
      const data = [
        makeItem('2026-03-08', 100), // Sun (prev week ending)
        makeItem('2026-03-09', 200), // Mon (new week starts)
      ];
      const result = aggregateForCharts(data, 'quarter');
      expect(result).toHaveLength(2);
    });

    it('labels with week start date MM/DD', () => {
      const data = [makeItem('2026-03-11', 100)]; // Wed
      const result = aggregateForCharts(data, 'quarter');
      // Week starts on Mon 03/09
      expect(result[0].date).toBe('03/09');
    });

    it('handles empty array', () => {
      expect(aggregateForCharts([], 'quarter')).toEqual([]);
    });
  });

  describe('year mode: aggregates by month', () => {
    it('groups days in same month together', () => {
      const data = [
        makeItem('2026-03-01', 100),
        makeItem('2026-03-10', 200),
        makeItem('2026-03-15', 300),
      ];
      const result = aggregateForCharts(data, 'year');
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('3月');
      expect(result[0].revenue).toBe(600);
      expect(result[0].record_count).toBe(3);
    });

    it('separates different months', () => {
      const data = [
        makeItem('2026-01-15', 100),
        makeItem('2026-02-10', 200),
        makeItem('2026-03-05', 300),
      ];
      const result = aggregateForCharts(data, 'year');
      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('1月');
      expect(result[1].date).toBe('2月');
      expect(result[2].date).toBe('3月');
    });

    it('sums all numeric fields correctly', () => {
      const data = [
        makeItem('2026-01-01', 100),
        makeItem('2026-01-31', 200),
      ];
      const result = aggregateForCharts(data, 'year');
      expect(result).toHaveLength(1);
      expect(result[0].revenue).toBe(300);
      expect(result[0].consultation_fee).toBeCloseTo(90); // 30+60
      expect(result[0].drug_fee).toBeCloseTo(210); // 70+140
      expect(result[0].record_count).toBe(2);
      expect(result[0].new_patient_count).toBe(2);
      expect(result[0].returning_patient_count).toBe(0);
    });

    it('handles empty array', () => {
      expect(aggregateForCharts([], 'year')).toEqual([]);
    });
  });
});
