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
            is_recovered: false,
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
            record_id: 3, record_diagnosis: '头痛', record_visit_date: '2020-01-01',
            planned_date: '2020-01-01', actual_date: null,
            status: 'overdue', method: '微信', content: '',
            is_recovered: false,
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

  it('renders recovered tag for recovered follow-ups', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 3, patient_id: 10, patient_name: '赵六',
            record_id: 7, record_diagnosis: '感冒', record_visit_date: '2026-03-10',
            planned_date: '2026-03-20', actual_date: '2026-03-20',
            status: 'completed', method: '电话', content: '已痊愈',
            is_recovered: true,
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-20',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('已康复')).toBeInTheDocument();
    });
  });

  it('renders not-recovered tag for non-recovered follow-ups', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 4, patient_id: 10, patient_name: '钱七',
            record_id: 8, record_diagnosis: '腰痛', record_visit_date: '2026-03-10',
            planned_date: '2026-03-20', actual_date: null,
            status: 'pending', method: '微信', content: '',
            is_recovered: false,
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-15',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('未康复')).toBeInTheDocument();
    });
  });
});
