import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUpPanel from '../FollowUpPanel';

// Mock API
vi.mock('../../api/followUp', () => ({
  listFollowUps: vi.fn(),
  createFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  deleteFollowUp: vi.fn(),
}));

// Mock useIsMobile
vi.mock('../../hooks/useIsMobile', () => ({ default: () => false }));

// Mock useAuth
vi.mock('../../store/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

import { listFollowUps, updateFollowUp, createFollowUp } from '../../api/followUp';

const mockList = listFollowUps as ReturnType<typeof vi.fn>;
const mockUpdate = updateFollowUp as ReturnType<typeof vi.fn>;
const mockCreate = createFollowUp as ReturnType<typeof vi.fn>;

const mockFollowUps = [
  {
    id: 1, tenant_id: 1, patient_id: 10, record_id: 100,
    patient_name: '张三', patient_phone: '13800000000',
    record_diagnosis: '感冒', record_visit_date: '2026-03-01',
    planned_date: '2020-01-01', actual_date: null,
    status: 'overdue', method: '电话', content: '询问退热情况',
    is_recovered: false, created_by: 1, created_by_name: '医生',
    created_at: '2026-03-01', updated_at: '2026-03-01',
  },
  {
    id: 2, tenant_id: 1, patient_id: 10, record_id: 100,
    patient_name: '张三', patient_phone: '13800000000',
    record_diagnosis: '感冒', record_visit_date: '2026-03-01',
    planned_date: '2099-04-01', actual_date: null,
    status: 'pending', method: '微信', content: '复查',
    is_recovered: false, created_by: 1, created_by_name: '医生',
    created_at: '2026-03-01', updated_at: '2026-03-01',
  },
];

describe('FollowUpPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: { list: mockFollowUps, total: 2 } });
    mockUpdate.mockResolvedValue({ data: {} });
    mockCreate.mockResolvedValue({ data: {} });
  });

  it('renders follow-up list with status badges', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getAllByText(/逾期/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/待回访/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state when no follow-ups', async () => {
    mockList.mockResolvedValue({ data: { list: [], total: 0 } });
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getByText(/暂无/)).toBeInTheDocument();
    });
  });

  it('calls API with record_id filter', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ record_id: 100 }));
    });
  });

  it('marks follow-up as complete on click', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getAllByText('完成').length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByText('完成')[0]);
    expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
      actual_date: expect.any(String),
    }));
  });

  it('shows new follow-up button', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getByText(/新建回访/)).toBeInTheDocument();
    });
  });

  it('auto-expands when has active follow-ups', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      // Should see content since there are pending/overdue items
      expect(screen.getByText('询问退热情况')).toBeInTheDocument();
    });
  });

  it('auto-expands and highlights when highlightFollowUpId is set', async () => {
    const { container } = render(
      <FollowUpPanel recordId={100} patientId={10} patientName="张三" highlightFollowUpId={1} />
    );
    await waitFor(() => {
      expect(container.querySelector('.followup-highlight')).toBeInTheDocument();
    });
  });
});
