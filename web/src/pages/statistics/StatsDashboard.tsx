import { useState, useEffect, useCallback } from 'react';
import { Radio, DatePicker, Spin, Empty } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getDashboard } from '../../api/statistics';
import type { DashboardData } from '../../api/statistics';
import useIsMobile from '../../hooks/useIsMobile';
import SummaryCards from './components/SummaryCards';
import RevenueTrendChart from './components/RevenueTrendChart';
import RevenueBreakdownChart from './components/RevenueBreakdownChart';
import PatientChart from './components/PatientChart';

const { RangePicker } = DatePicker;

type QuickRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

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
      setData(res.data.data);
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
            <RevenueTrendChart data={data.daily_trend} />
            <div
              style={{
                display: isMobile ? 'flex' : 'grid',
                flexDirection: 'column',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 16,
              }}
            >
              <RevenueBreakdownChart data={data.daily_trend} />
              <PatientChart data={data.daily_trend} />
            </div>
          </div>
        ) : (
          !loading && <Empty description="暂无统计数据" />
        )}
      </Spin>
    </div>
  );
}
