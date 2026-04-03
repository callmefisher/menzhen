import { useState, useEffect, useCallback, useMemo } from 'react';
import { Radio, DatePicker, Spin, Empty, Tabs } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { Dayjs } from 'dayjs';

dayjs.locale('zh-cn');

import { getDashboard } from '../../api/statistics';
import type { DashboardData, DailyTrendItem } from '../../api/statistics';
import useIsMobile from '../../hooks/useIsMobile';
import { useAuth } from '../../store/auth';
import SummaryCards from './components/SummaryCards';
import RevenueTrendChart from './components/RevenueTrendChart';
import RevenueBreakdownChart from './components/RevenueBreakdownChart';
import PatientChart from './components/PatientChart';
import StaffRevenuePanel from './components/StaffRevenuePanel';
import GlobalStatsPanel from './components/GlobalStatsPanel';

const { RangePicker } = DatePicker;

export type QuickRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

function getDateRange(range: QuickRange): [Dayjs, Dayjs] {
  const now = dayjs();
  switch (range) {
    case 'today':
      return [now.startOf('day'), now.endOf('day')];
    case 'week': {
      // 显式计算本周一~周日，不依赖 locale startOf('week')
      const day = now.day(); // 0=周日, 1=周一, ..., 6=周六
      const diffToMonday = day === 0 ? 6 : day - 1;
      const monday = now.subtract(diffToMonday, 'day').startOf('day');
      const sunday = monday.add(6, 'day').endOf('day');
      return [monday, sunday];
    }
    case 'month':
      return [now.startOf('month'), now.endOf('month')];
    case 'quarter': {
      const quarterMonth = Math.floor(now.month() / 3) * 3;
      const quarterStart = now.month(quarterMonth).startOf('month');
      const quarterEnd = quarterStart.add(2, 'month').endOf('month');
      return [quarterStart, quarterEnd];
    }
    case 'year':
      return [now.startOf('year'), now.endOf('year')];
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
  const { isSuperAdmin } = useAuth();
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getDateRange('month'));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [overrideTenantId, setOverrideTenantId] = useState<number | null>(null);
  const [overrideTenantName, setOverrideTenantName] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDashboard(
        dateRange[0].format('YYYY-MM-DD'),
        dateRange[1].format('YYYY-MM-DD'),
        overrideTenantId ?? undefined,
      );
      const body = res as unknown as { code: number; data: DashboardData };
      setData(body.data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [dateRange, overrideTenantId]);

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

  const handleViewDetail = useCallback((tenantId: number, tenantName: string) => {
    setOverrideTenantId(tenantId);
    setOverrideTenantName(tenantName);
    setActiveTab('overview');
  }, []);

  const chartData = useMemo(
    () => (data ? aggregateForCharts(data.daily_trend, quickRange) : []),
    [data, quickRange],
  );

  const startDateStr = dateRange[0].format('YYYY-MM-DD');
  const endDateStr = dateRange[1].format('YYYY-MM-DD');

  const filterBar = (
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
        value={dateRange}
        onChange={handleRangeChange}
        style={{ minWidth: isMobile ? 200 : 240 }}
      />
    </div>
  );

  const overviewContent = (
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
  );

  const tenantAlert = isSuperAdmin && overrideTenantName ? (
    <div style={{ marginBottom: 12, padding: '8px 14px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: '#389e0d' }}>当前查看：<b>{overrideTenantName}</b></span>
      <button
        onClick={() => { setOverrideTenantId(null); setOverrideTenantName(null); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16 }}
      >✕</button>
    </div>
  ) : null;

  const tabItems = [
    { key: 'overview', label: '数据概览', children: <>{tenantAlert}{overviewContent}</> },
    {
      key: 'staff',
      label: '人员收费',
      children: <StaffRevenuePanel startDate={startDateStr} endDate={endDateStr} />,
    },
    ...(isSuperAdmin ? [{
      key: 'global',
      label: <span>全局总览 <span style={{ display: 'inline-block', background: '#ff4d4f', color: '#fff', fontSize: 9, borderRadius: 8, padding: '1px 4px', marginLeft: 2, verticalAlign: 'middle' }}>Admin</span></span>,
      children: (
        <GlobalStatsPanel
          startDate={startDateStr}
          endDate={endDateStr}
          onViewDetail={handleViewDetail}
        />
      ),
    }] : []),
  ];

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      {filterBar}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
    </div>
  );
}
