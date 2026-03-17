import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  getPatient: vi.fn().mockResolvedValue({ data: { phone: '' } }),
}));
vi.mock('../../../api/record', () => ({
  listRecords: vi.fn(),
  getRecord: vi.fn(),
}));

// Mock auth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    user: { id: 1, real_name: 'Admin' },
    token: 'test-token',
  }),
}));

// Mock useIsMobile — configurable per test
let mockIsMobile = false;
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => mockIsMobile,
}));

import { listFollowUps, getFollowUpStats } from '../../../api/followUp';
import { getRecord } from '../../../api/record';

const mockListFollowUps = listFollowUps as ReturnType<typeof vi.fn>;
const mockGetStats = getFollowUpStats as ReturnType<typeof vi.fn>;
const mockGetRecord = getRecord as ReturnType<typeof vi.fn>;

describe('FollowUpList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMobile = false;
    mockGetStats.mockResolvedValue({ data: { pending_count: 2, overdue_count: 1, today_count: 1, completed_count: 5, total_count: 9 } });
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

  it('renders pill tabs with stats counts', async () => {
    mockListFollowUps.mockResolvedValue({
      data: { list: [], total: 0, page: 1, size: 20 },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/全部 9/)).toBeInTheDocument();
      expect(screen.getByText(/待回访 2/)).toBeInTheDocument();
      expect(screen.getByText(/逾期 1/)).toBeInTheDocument();
      expect(screen.getByText(/已完成 5/)).toBeInTheDocument();
      // Recovery row
      expect(screen.getByText(/已康复/)).toBeInTheDocument();
      expect(screen.getByText(/未康复/)).toBeInTheDocument();
    });

    // Sort indicator in column header
    expect(screen.getByText('日期')).toBeInTheDocument();
  });

  it('toggles sort order on column header click', async () => {
    const user = userEvent.setup();
    mockListFollowUps.mockResolvedValue({
      data: { list: [], total: 0, page: 1, size: 20 },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalled();
    });

    // Click sort toggle
    await user.click(screen.getByText('日期'));

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 'desc' }),
      );
    });
  });

  it('filters by status when clicking pill tab', async () => {
    const user = userEvent.setup();
    mockListFollowUps.mockResolvedValue({
      data: { list: [], total: 0, page: 1, size: 20 },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalled();
    });

    // Click "待回访" pill
    await user.click(screen.getByText(/待回访 2/));

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
      );
    });
  });

  describe('mobile mode', () => {
    beforeEach(() => {
      mockIsMobile = true;
    });

    it('renders two separate DatePickers instead of RangePicker on mobile', async () => {
      mockListFollowUps.mockResolvedValue({
        data: { list: [], total: 0, page: 1, size: 20 },
      });

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(mockListFollowUps).toHaveBeenCalled();
      });

      // Two separate date pickers with placeholders
      expect(screen.getByPlaceholderText('开始日期')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('结束日期')).toBeInTheDocument();
    });

    it('renders mobile card layout with patient data', async () => {
      mockListFollowUps.mockResolvedValue({
        data: {
          list: [
            {
              id: 1, patient_id: 10, patient_name: '张三', patient_phone: '13800001111',
              record_id: 5, record_diagnosis: '感冒', record_visit_date: '2026-03-10',
              planned_date: '2026-03-20', actual_date: null,
              status: 'pending', method: '电话', content: '',
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

      // Mobile sort bar
      expect(screen.getByText(/共 1 条/)).toBeInTheDocument();
    });

    it('renders mobile sort bar and toggles sort order', async () => {
      const user = userEvent.setup();
      mockListFollowUps.mockResolvedValue({
        data: { list: [], total: 0, page: 1, size: 20 },
      });

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(mockListFollowUps).toHaveBeenCalled();
      });

      // Default sort label
      const sortBtn = screen.getByText(/计划日期升序/);
      expect(sortBtn).toBeInTheDocument();

      // Toggle sort
      await user.click(sortBtn);

      await waitFor(() => {
        expect(mockListFollowUps).toHaveBeenCalledWith(
          expect.objectContaining({ sort_order: 'desc' }),
        );
      });
    });
  });

  describe('record expand/collapse', () => {
    const mockFollowUpWithRecord = {
      id: 10, patient_id: 20, patient_name: '测试',
      record_id: 100, record_diagnosis: '腰椎间盘突出', record_visit_date: '2026-03-10',
      planned_date: '2026-03-20', actual_date: null,
      status: 'pending' as const, method: '电话', content: '',
      is_recovered: false,
      created_by: 1, created_by_name: '李医生',
      created_at: '2026-03-15', updated_at: '2026-03-15',
    };

    const mockRecordDetail = {
      data: {
        diagnosis: '腰椎间盘突出伴坐骨神经痛',
        treatment: '针灸+推拿',
        prescriptions: [
          { formula_name: '独活寄生汤', total_doses: 7, items: [{ herb_name: '独活', dosage: '15g' }] },
        ],
      },
    };

    it('shows expand tag with diagnosis summary in desktop mode', async () => {
      mockListFollowUps.mockResolvedValue({
        data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
      });

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText('测试')).toBeInTheDocument();
      });

      // Tag should show visit date and truncated diagnosis
      expect(screen.getByText('2026-03-10')).toBeInTheDocument();
      expect(screen.getByText(/腰椎间盘突出/)).toBeInTheDocument();
      // "查看" link should exist
      expect(screen.getByText('查看')).toBeInTheDocument();
    });

    it('expands to show full record details on tag click', async () => {
      const user = userEvent.setup();
      mockListFollowUps.mockResolvedValue({
        data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
      });
      mockGetRecord.mockResolvedValue(mockRecordDetail);

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText('测试')).toBeInTheDocument();
      });

      // Click the expand tag
      const tag = screen.getByText('2026-03-10').closest('.record-expand-tag')!;
      await user.click(tag);

      // Should show full details
      await waitFor(() => {
        expect(screen.getByText('腰椎间盘突出伴坐骨神经痛')).toBeInTheDocument();
        expect(screen.getByText('针灸+推拿')).toBeInTheDocument();
        expect(screen.getByText(/独活寄生汤 7剂/)).toBeInTheDocument();
      });

      expect(mockGetRecord).toHaveBeenCalledWith(100);
    });

    it('collapses on second click', async () => {
      const user = userEvent.setup();
      mockListFollowUps.mockResolvedValue({
        data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
      });
      mockGetRecord.mockResolvedValue(mockRecordDetail);

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText('测试')).toBeInTheDocument();
      });

      const tag = screen.getByText('2026-03-10').closest('.record-expand-tag')!;

      // Expand
      await user.click(tag);
      await waitFor(() => {
        expect(screen.getByText('腰椎间盘突出伴坐骨神经痛')).toBeInTheDocument();
      });

      // Collapse
      await user.click(tag);
      await waitFor(() => {
        expect(screen.queryByText('腰椎间盘突出伴坐骨神经痛')).not.toBeInTheDocument();
      });
    });

    it('uses cache on re-expand (no second API call)', async () => {
      const user = userEvent.setup();
      mockListFollowUps.mockResolvedValue({
        data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
      });
      mockGetRecord.mockResolvedValue(mockRecordDetail);

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText('测试')).toBeInTheDocument();
      });

      const tag = screen.getByText('2026-03-10').closest('.record-expand-tag')!;

      // Expand → Collapse → Re-expand
      await user.click(tag);
      await waitFor(() => { expect(screen.getByText('针灸+推拿')).toBeInTheDocument(); });
      await user.click(tag);
      await waitFor(() => { expect(screen.queryByText('针灸+推拿')).not.toBeInTheDocument(); });
      await user.click(tag);
      await waitFor(() => { expect(screen.getByText('针灸+推拿')).toBeInTheDocument(); });

      // getRecord should only be called once (cached)
      expect(mockGetRecord).toHaveBeenCalledTimes(1);
    });

    it('shows dash when no record_id', async () => {
      mockListFollowUps.mockResolvedValue({
        data: {
          list: [{
            ...mockFollowUpWithRecord, id: 11, record_id: 0, record_diagnosis: '', record_visit_date: null,
          }],
          total: 1, page: 1, size: 20,
        },
      });

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => {
        expect(screen.getByText('测试')).toBeInTheDocument();
      });

      // Should show '—' instead of expand tag
      expect(screen.queryByText('查看')).not.toBeInTheDocument();
    });

    it('collapses on fetch error and allows single-click retry', async () => {
      const user = userEvent.setup();
      mockListFollowUps.mockResolvedValue({
        data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
      });
      // First call fails, second succeeds
      mockGetRecord
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(mockRecordDetail);

      render(<MemoryRouter><FollowUpList /></MemoryRouter>);

      await waitFor(() => { expect(screen.getByText('测试')).toBeInTheDocument(); });

      const tag = screen.getByText('2026-03-10').closest('.record-expand-tag')!;

      // First click — fails, should auto-collapse
      await user.click(tag);
      await waitFor(() => {
        expect(mockGetRecord).toHaveBeenCalledTimes(1);
      });
      // Panel should be collapsed (error auto-clears expand state)
      await waitFor(() => {
        expect(screen.queryByText('腰椎间盘突出伴坐骨神经痛')).not.toBeInTheDocument();
      });

      // Single click retry — should succeed
      await user.click(tag);
      await waitFor(() => {
        expect(screen.getByText('腰椎间盘突出伴坐骨神经痛')).toBeInTheDocument();
      });
      expect(mockGetRecord).toHaveBeenCalledTimes(2);
    });

    describe('mobile expand', () => {
      beforeEach(() => {
        mockIsMobile = true;
      });

      it('expands record details in mobile card', async () => {
        const user = userEvent.setup();
        mockListFollowUps.mockResolvedValue({
          data: { list: [mockFollowUpWithRecord], total: 1, page: 1, size: 20 },
        });
        mockGetRecord.mockResolvedValue(mockRecordDetail);

        render(<MemoryRouter><FollowUpList /></MemoryRouter>);

        await waitFor(() => {
          expect(screen.getByText('测试')).toBeInTheDocument();
        });

        // Mobile Tag has date+diagnosis as single text node, use regex
        const tag = screen.getByText(/2026-03-10/).closest('.record-expand-tag')!;
        await user.click(tag);

        await waitFor(() => {
          expect(screen.getByText('腰椎间盘突出伴坐骨神经痛')).toBeInTheDocument();
          expect(screen.getByText('针灸+推拿')).toBeInTheDocument();
        });
      });
    });
  });
});
