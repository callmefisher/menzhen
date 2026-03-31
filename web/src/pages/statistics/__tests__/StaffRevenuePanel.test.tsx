import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import StaffRevenuePanel from '../components/StaffRevenuePanel';

vi.mock('../../../api/statistics', () => ({
  getStaffRevenue: vi.fn(),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: vi.fn().mockReturnValue(false),
}));

import * as statisticsApi from '../../../api/statistics';

const mockStaffData = {
  code: 0,
  data: {
    summary: {
      total_revenue: 28640,
      total_records: 142,
      staff_count: 4,
      avg_per_record: 201.69,
    },
    staff: [
      {
        user_id: 1,
        real_name: '李医生',
        revenue: 12300,
        consultation_fee: 5800,
        drug_fee: 6500,
        record_count: 58,
        avg_per_record: 212.07,
        revenue_percent: 42.9,
      },
      {
        user_id: 2,
        real_name: '王医生',
        revenue: 9840,
        consultation_fee: 4600,
        drug_fee: 5240,
        record_count: 46,
        avg_per_record: 213.91,
        revenue_percent: 34.4,
      },
    ],
  },
};

function renderPanel(startDate = '2026-03-01', endDate = '2026-03-31') {
  return render(
    <BrowserRouter>
      <StaffRevenuePanel startDate={startDate} endDate={endDate} />
    </BrowserRouter>,
  );
}

describe('StaffRevenuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (statisticsApi.getStaffRevenue as ReturnType<typeof vi.fn>).mockResolvedValue(mockStaffData);
  });

  it('renders summary cards', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('¥28,640')).toBeInTheDocument();
    });
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('4人')).toBeInTheDocument();
  });

  it('renders rank cards for each staff member', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('李医生')).toBeInTheDocument();
    });
    expect(screen.getByText('王医生')).toBeInTheDocument();
  });

  it('renders revenue amounts', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('¥12,300')).toBeInTheDocument();
    });
    expect(screen.getByText('¥9,840')).toBeInTheDocument();
  });

  it('renders drug fee and consultation fee labels', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('诊金')[0]).toBeInTheDocument();
    });
    expect(screen.getAllByText('药费')[0]).toBeInTheDocument();
  });

  it('shows empty state when no data', async () => {
    (statisticsApi.getStaffRevenue as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 0,
      data: { summary: { total_revenue: 0, total_records: 0, staff_count: 0, avg_per_record: 0 }, staff: [] },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('暂无人员收费数据')).toBeInTheDocument();
    });
  });

  it('renders rank numbers', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
