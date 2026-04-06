import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import StatsDashboard from '../StatsDashboard';
import * as statsApi from '../../../api/statistics';
import * as authStore from '../../../store/auth';


// Mock must match what request interceptor actually returns:
// interceptor does `response.data`, so getDashboard resolves to { code, data }.
vi.mock('../../../api/statistics', () => ({
  getDashboard: vi.fn().mockResolvedValue({
    code: 0,
    data: {
      summary: {
        total_revenue: 48600,
        total_records: 156,
        total_patients: 89,
        avg_revenue_per_record: 311.54,
        revenue_change_percent: 12.5,
        records_change_percent: 8.3,
        patients_change_percent: 5.2,
        cure_rate: 72.5,
        cure_rate_change_percent: 3.2,
      },
      daily_trend: [
        {
          date: '2026-03-01',
          revenue: 1680,
          consultation_fee: 500,
          drug_fee: 1180,
          record_count: 6,
          new_patient_count: 2,
          returning_patient_count: 4,
        },
      ],
      revenue_breakdown: { consultation_fee_total: 15600, drug_fee_total: 33000 },
      patient_breakdown: { new_patients: 34, returning_patients: 55 },
    },
  }),
  getStaffRevenue: vi.fn().mockResolvedValue({
    code: 0,
    data: { summary: { total_revenue: 0, total_records: 0, staff_count: 0, avg_per_record: 0 }, staff: [] },
  }),
  getGlobalStats: vi.fn().mockResolvedValue({
    code: 0,
    data: {
      summary: { total_revenue: 0, total_records: 0, total_patients: 0, avg_revenue_per_record: 0, tenant_count: 0, total: 0 },
      tenants: [],
    },
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../store/auth', () => ({
  useAuth: vi.fn().mockReturnValue({ isSuperAdmin: false, isPowerAdmin: false, managedGroups: [] }),
}));

vi.mock('echarts-for-react', () => ({
  default: ({ option: _option, ...props }: any) => <div data-testid="echarts-mock" {...props} />,
}));

vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option: _option, echarts: _echarts, ...props }: any) => <div data-testid="echarts-mock" {...props} />,
}));

vi.mock('../../../utils/echartsConfig', () => ({
  default: { use: vi.fn() },
}));

function renderWithRouter() {
  return render(
    <BrowserRouter>
      <StatsDashboard />
    </BrowserRouter>,
  );
}

describe('StatsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary cards with data', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('¥48,600')).toBeInTheDocument();
    });
    expect(screen.getByText('156')).toBeInTheDocument();
    expect(screen.getByText('89')).toBeInTheDocument();
  });

  it('renders cure rate card', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('治愈率')).toBeInTheDocument();
    });
    expect(screen.getByText('72.5%')).toBeInTheDocument();
  });

  it('renders time range buttons', async () => {
    renderWithRouter();
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('本季')).toBeInTheDocument();
    expect(screen.getByText('本年')).toBeInTheDocument();
  });

  it('renders chart titles', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('收入趋势 + 诊疗量')).toBeInTheDocument();
    });
    expect(screen.getByText('诊金 vs 药费')).toBeInTheDocument();
    expect(screen.getByText('新增 vs 复诊患者')).toBeInTheDocument();
  });

  it('switches time range on button click', async () => {
    const { getDashboard } = await import('../../../api/statistics');
    renderWithRouter();
    await waitFor(() => {
      expect(getDashboard).toHaveBeenCalled();
    });

    const todayBtn = screen.getByText('今日');
    await userEvent.click(todayBtn);
    await waitFor(() => {
      expect(getDashboard).toHaveBeenCalledTimes(2);
    });
  });

  it('shows empty state when no data', async () => {
    const { getDashboard } = await import('../../../api/statistics');
    (getDashboard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 0,
      data: null,
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('暂无统计数据')).toBeInTheDocument();
    });
  });

  it('renders Tabs with 诊所统计 and 人员统计', () => {
    renderWithRouter();
    expect(screen.getByText('诊所统计')).toBeInTheDocument();
    expect(screen.getByText('人员统计')).toBeInTheDocument();
  });
});

describe('StatsDashboard global tab visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(statsApi, 'getGlobalStats').mockResolvedValue({
      code: 0,
      data: {
        summary: { total_revenue: 0, total_records: 0, total_patients: 0, avg_revenue_per_record: 0, tenant_count: 0, total: 0 },
        tenants: [],
      },
    } as never);
  });

  it('shows 全局总览 tab for superAdmin', () => {
    vi.spyOn(authStore, 'useAuth').mockReturnValue({
      isSuperAdmin: true,
      isPowerAdmin: false,
      managedGroups: [],
      user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
      permissions: ['user:manage'],
      token: 'mock',
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      hasPermission: vi.fn().mockReturnValue(true),
      isGlobalAdmin: true,
      queueEnabled: false,
      appointmentEnabled: false,
      fetchQueueEnabled: vi.fn(),
      fetchAppointmentEnabled: vi.fn(),
    } as never);
    renderWithRouter();
    expect(screen.getByText(/全局总览/)).toBeInTheDocument();
  });

  it('hides 全局总览 tab for regular user', () => {
    // explicitly set isSuperAdmin: false to override the spy from previous test
    vi.spyOn(authStore, 'useAuth').mockReturnValue({
      isSuperAdmin: false,
      isPowerAdmin: false,
      managedGroups: [],
      user: { id: 1, username: 'user', real_name: '普通用户', tenant_id: 1 },
      permissions: [],
      token: 'mock',
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      hasPermission: vi.fn().mockReturnValue(false),
      isGlobalAdmin: false,
      queueEnabled: false,
      appointmentEnabled: false,
      fetchQueueEnabled: vi.fn(),
      fetchAppointmentEnabled: vi.fn(),
    } as never);
    renderWithRouter();
    expect(screen.queryByText(/全局总览/)).toBeNull();
  });
});
