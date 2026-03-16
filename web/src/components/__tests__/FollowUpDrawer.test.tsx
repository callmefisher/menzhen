import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FollowUpDrawer from '../FollowUpDrawer';

const followUpApi = vi.hoisted(() => ({
  createFollowUp: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  listFollowUps: vi.fn().mockResolvedValue({ code: 0, data: { list: [], total: 0 } }),
  getFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  deleteFollowUp: vi.fn(),
  getFollowUpStats: vi.fn(),
}));

vi.mock('../../api/followUp', () => followUpApi);

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

describe('FollowUpDrawer', () => {
  const defaultProps = {
    open: true,
    recordId: 42,
    patientId: 10,
    patientName: '张三',
    visitDate: '2025-06-01',
    diagnosis: '脾虚湿困',
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders drawer with patient info and form fields', async () => {
    render(<FollowUpDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('创建回访计划')).toBeInTheDocument();
    });

    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('2025-06-01')).toBeInTheDocument();
    expect(screen.getByText('脾虚湿困')).toBeInTheDocument();
    expect(screen.getByText('计划回访日期')).toBeInTheDocument();
    expect(screen.getByText('回访方式')).toBeInTheDocument();
    expect(screen.getByText('回访内容')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <FollowUpDrawer {...defaultProps} open={false} />
    );
    expect(container.querySelector('.ant-drawer-open')).toBeNull();
  });

  it('calls createFollowUp and onSuccess on submit', async () => {
    const user = userEvent.setup();

    render(<FollowUpDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('创建回访计划')).toBeInTheDocument();
    });

    // Fill content
    const textarea = screen.getByPlaceholderText('请输入回访时需要询问/提醒的内容');
    await user.type(textarea, '询问用药后症状改善情况');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /创建回访/ });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(followUpApi.createFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          patient_id: 10,
          record_id: 42,
          method: '电话',
          content: '询问用药后症状改善情况',
        })
      );
    });

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<FollowUpDrawer {...defaultProps} />);

    const cancelBtn = screen.getByRole('button', { name: /取.*消/ });
    await user.click(cancelBtn);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows error message when createFollowUp fails', async () => {
    followUpApi.createFollowUp.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();

    render(<FollowUpDrawer {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('创建回访计划')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /创建回访/ });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(followUpApi.createFollowUp).toHaveBeenCalled();
    });

    // onSuccess should NOT be called on failure
    expect(defaultProps.onSuccess).not.toHaveBeenCalled();
  });

  it('renders without diagnosis when not provided', async () => {
    render(<FollowUpDrawer {...defaultProps} diagnosis={undefined} />);

    await waitFor(() => {
      expect(screen.getByText('创建回访计划')).toBeInTheDocument();
    });

    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.queryByText('诊断')).toBeNull();
  });
});
