import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import GlobalStatsPanel from '../GlobalStatsPanel';
import * as statsApi from '../../../../api/statistics';
import type { GlobalStatsData } from '../../../../api/statistics';

vi.mock('../../../../store/auth', () => ({
  useAuth: () => ({ isPowerAdmin: false, managedGroups: [], isSuperAdmin: false, isGlobalAdmin: false }),
}));

const mockData: GlobalStatsData = {
  summary: {
    total_revenue: 10000,
    total_records: 100,
    total_patients: 80,
    avg_revenue_per_record: 100,
    tenant_count: 2,
    total: 2,
  },
  tenants: [
    { tenant_id: 1, tenant_name: '诊所A', revenue: 6000, records: 60, patients: 50, avg_per_record: 100, revenue_percent: 60 },
    { tenant_id: 2, tenant_name: '诊所B', revenue: 4000, records: 40, patients: 30, avg_per_record: 100, revenue_percent: 40 },
  ],
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConfigProvider>{children}</ConfigProvider>
);

describe('GlobalStatsPanel', () => {
  beforeEach(() => {
    vi.spyOn(statsApi, 'getGlobalStats').mockResolvedValue({
      code: 0, data: mockData,
    } as never);
  });

  it('renders summary cards with correct totals', async () => {
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText(/10,000/)).toBeTruthy());
    expect(screen.getByText('100')).toBeTruthy(); // total_records
  });

  it('renders tenant ranking list', async () => {
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('诊所A')).toBeTruthy());
    expect(screen.getByText('诊所B')).toBeTruthy();
  });

  it('calls onViewDetail when 查看完整报表 is clicked after expanding a row', async () => {
    const onViewDetail = vi.fn();
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={onViewDetail} />,
      { wrapper },
    );
    await waitFor(() => screen.getByText('诊所A'));
    // Click the first tenant row to expand it
    const rows = screen.getAllByText('诊所A');
    fireEvent.click(rows[0]);
    // Click the 查看完整报表 button in the expanded area
    await waitFor(() => {
      const btns = screen.getAllByText('查看完整报表');
      fireEvent.click(btns[0]);
    });
    expect(onViewDetail).toHaveBeenCalledWith(1, '诊所A');
  });

  it('shows loading skeleton while fetching', () => {
    vi.spyOn(statsApi, 'getGlobalStats').mockReturnValue(new Promise(() => {}));
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    expect(document.querySelector('.ant-skeleton')).toBeTruthy();
  });
});
