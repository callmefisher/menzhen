import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FollowUpList from '../FollowUpList';

// Mock antd message
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

// Mock API
vi.mock('../../../api/followUp', () => ({
  listFollowUps: vi.fn(),
  createFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  deleteFollowUp: vi.fn(),
  getFollowUpStats: vi.fn(),
}));

// Mock patient/record API for select dropdowns
vi.mock('../../../api/patient', () => ({
  listPatients: vi.fn(),
}));
vi.mock('../../../api/record', () => ({
  listRecords: vi.fn(),
}));

// Mock auth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    user: { id: 1, real_name: 'Admin' },
    token: 'test-token',
  }),
}));

// Mock useIsMobile
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

import { listFollowUps, getFollowUpStats } from '../../../api/followUp';

const mockListFollowUps = listFollowUps as ReturnType<typeof vi.fn>;
const mockGetStats = getFollowUpStats as ReturnType<typeof vi.fn>;

describe('FollowUpList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockResolvedValue({ data: { pending_count: 2, overdue_count: 1, today_count: 1, completed_count: 5 } });
  });

  it('renders follow-up list with data', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 1, patient_id: 10, patient_name: '张三',
            record_id: 5, record_diagnosis: '感冒', record_visit_date: '2026-03-10',
            planned_date: '2026-03-20', actual_date: null,
            status: 'pending', method: '电话', content: '回访',
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-15',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
  });

  it('renders empty state', async () => {
    mockListFollowUps.mockResolvedValue({
      data: { list: [], total: 0, page: 1, size: 20 },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalled();
    });
  });

  it('renders overdue status tag', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 2, patient_id: 10, patient_name: '王五',
            record_id: null, record_diagnosis: '', record_visit_date: null,
            planned_date: '2020-01-01', actual_date: null,
            status: 'overdue', method: '微信', content: '',
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-15',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('逾期')).toBeInTheDocument();
    });
  });
});
