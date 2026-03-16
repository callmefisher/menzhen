import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import StatsDashboard from '../StatsDashboard';


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
        {
          date: '2026-03-02',
          revenue: 2100,
          consultation_fee: 600,
          drug_fee: 1500,
          record_count: 8,
          new_patient_count: 3,
          returning_patient_count: 5,
        },
      ],
      revenue_breakdown: { consultation_fee_total: 15600, drug_fee_total: 33000 },
      patient_breakdown: { new_patients: 34, returning_patients: 55 },
    },
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: vi.fn().mockReturnValue(false),
}));

// Capture props passed to the revenue trend chart's ECharts instance
let capturedEChartsProps: Record<string, any>[] = [];

vi.mock('echarts-for-react', () => ({
  default: vi.fn((props: any) => {
    capturedEChartsProps.push(props);
    return <div data-testid="echarts-mock" />;
  }),
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
    capturedEChartsProps = [];
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

  it('passes dataZoom props to RevenueTrendChart on desktop with month range', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('¥48,600')).toBeInTheDocument();
    });
    // First echarts instance is RevenueTrendChart (rendered first)
    const revenueTrendProps = capturedEChartsProps[0];
    expect(revenueTrendProps).toBeDefined();
    // dataZoom should be enabled (desktop + month range)
    const dz = revenueTrendProps.option.dataZoom;
    expect(dz).toHaveLength(2);
    expect(dz[0].type).toBe('slider');
    // onEvents should have datazoom handler
    expect(revenueTrendProps.onEvents).toHaveProperty('datazoom');
  });

  it('disables dataZoom in quarter mode', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('¥48,600')).toBeInTheDocument();
    });
    capturedEChartsProps = [];

    const quarterBtn = screen.getByText('本季');
    await userEvent.click(quarterBtn);
    await waitFor(() => {
      const revenueTrendProps = capturedEChartsProps[0];
      expect(revenueTrendProps).toBeDefined();
      expect(revenueTrendProps.option.dataZoom).toEqual([]);
    });
  });

  it('disables dataZoom in year mode', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('¥48,600')).toBeInTheDocument();
    });
    capturedEChartsProps = [];

    const yearBtn = screen.getByText('本年');
    await userEvent.click(yearBtn);
    await waitFor(() => {
      const revenueTrendProps = capturedEChartsProps[0];
      expect(revenueTrendProps).toBeDefined();
      expect(revenueTrendProps.option.dataZoom).toEqual([]);
    });
  });
});
