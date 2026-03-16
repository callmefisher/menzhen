import { useState, useEffect, useCallback, useMemo } from 'react';
import { Radio, DatePicker, Spin, Empty } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { Dayjs } from 'dayjs';

dayjs.locale('zh-cn');

import { getDashboard } from '../../api/statistics';
import type { DashboardData, DailyTrendItem } from '../../api/statistics';
import useIsMobile from '../../hooks/useIsMobile';
import SummaryCards from './components/SummaryCards';
import RevenueTrendChart from './components/RevenueTrendChart';
import RevenueBreakdownChart from './components/RevenueBreakdownChart';
import PatientChart from './components/PatientChart';

const { RangePicker } = DatePicker;

export type QuickRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

function getDateRange(range: QuickRange): [Dayjs, Dayjs] {
  const now = dayjs();
  switch (range) {
    case 'today':
      return [now.startOf('day'), now.endOf('day')];
    case 'week':
      return [now.startOf('week'), now.endOf('day')];
    case 'month':
      return [now.startOf('month'), now.endOf('day')];
    case 'quarter': {
      const quarterMonth = Math.floor(now.month() / 3) * 3;
      return [now.month(quarterMonth).startOf('month'), now.endOf('day')];
    }
    case 'year':
      return [now.startOf('year'), now.endOf('day')];
    default:
      return [now.startOf('month'), now.endOf('day')];
  }
}

/**
 * Aggregate daily trend data for chart display based on the selected time range.
 * today/week/month → daily labels (MM-DD)
 * quarter → weekly labels (MM/DD)
 * year → monthly labels (N月)
 */
export function aggregateForCharts(data: DailyTrendItem[], range: QuickRange): DailyTrendItem[] {
  if (range === 'today' || range === 'week' || range === 'month' || range === 'custom') {
    return data.map((d) => ({ ...d, date: d.date.slice(5) }));
  }

  const groups = new Map<string, DailyTrendItem>();

  for (const item of data) {
    let key: string;
    if (range === 'quarter') {
      const weekStart = dayjs(item.date).startOf('week');
      key = weekStart.format('MM/DD');
    } else {
      key = `${parseInt(item.date.slice(5, 7))}月`;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.revenue += item.revenue;
      existing.consultation_fee += item.consultation_fee;
      existing.drug_fee += item.drug_fee;
      existing.record_count += item.record_count;
      existing.new_patient_count += item.new_patient_count;
      existing.returning_patient_count += item.returning_patient_count;
    } else {
      groups.set(key, { ...item, date: key });
    }
  }

  return Array.from(groups.values());
}

export default function StatsDashboard() {
  const isMobile = useIsMobile();
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getDateRange('month'));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDashboard(
        dateRange[0].format('YYYY-MM-DD'),
        dateRange[1].format('YYYY-MM-DD'),
      );
      const body = res as unknown as { code: number; data: DashboardData };
      setData(body.data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleQuickRange = (range: QuickRange) => {
    setQuickRange(range);
    if (range !== 'custom') {
      setDateRange(getDateRange(range));
    }
  };

  const handleRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates && dates[0] && dates[1]) {
      setQuickRange('custom');
      setDateRange([dates[0], dates[1]]);
    }
  };

  const chartData = useMemo(
    () => (data ? aggregateForCharts(data.daily_trend, quickRange) : []),
    [data, quickRange],
  );

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          overflowX: isMobile ? 'auto' : undefined,
        }}
      >
        <Radio.Group
          value={quickRange}
          onChange={(e) => handleQuickRange(e.target.value)}
          size={isMobile ? 'small' : 'middle'}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="today">今日</Radio.Button>
          <Radio.Button value="week">本周</Radio.Button>
          <Radio.Button value="month">本月</Radio.Button>
          <Radio.Button value="quarter">本季</Radio.Button>
          <Radio.Button value="year">本年</Radio.Button>
        </Radio.Group>
        <RangePicker
          size={isMobile ? 'small' : 'middle'}
          value={quickRange === 'custom' ? dateRange : undefined}
          onChange={handleRangeChange}
          style={{ minWidth: isMobile ? 200 : 240 }}
        />
      </div>

      <Spin spinning={loading}>
        {data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SummaryCards summary={data.summary} />
            <RevenueTrendChart data={chartData} />
            <div
              style={{
                display: isMobile ? 'flex' : 'grid',
                flexDirection: 'column',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 16,
              }}
            >
              <RevenueBreakdownChart data={chartData} />
              <PatientChart data={chartData} />
            </div>
          </div>
        ) : (
          !loading && <Empty description="暂无统计数据" />
        )}
      </Spin>
    </div>
  );
}
