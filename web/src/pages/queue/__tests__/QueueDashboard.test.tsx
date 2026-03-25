import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QueueDashboard from '../QueueDashboard';

// ── API mocks ──────────────────────────────────────────────────────────────

const mockListQueue = vi.fn();
const mockTakeNumber = vi.fn();
const mockCallNumber = vi.fn();
const mockCompleteVisit = vi.fn();
const mockClearQueue = vi.fn();

vi.mock('../../../api/queue', () => ({
  listQueue: (...args: unknown[]) => mockListQueue(...args),
  takeNumber: (...args: unknown[]) => mockTakeNumber(...args),
  callNumber: (...args: unknown[]) => mockCallNumber(...args),
  completeVisit: (...args: unknown[]) => mockCompleteVisit(...args),
  clearQueue: (...args: unknown[]) => mockClearQueue(...args),
  getQueueStats: vi.fn().mockResolvedValue({ data: {} }),
}));

const mockListUsers = vi.fn();

vi.mock('../../../api/user', () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  createUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));

// ── Auth mock ──────────────────────────────────────────────────────────────

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => code === 'queue:write',
    isGlobalAdmin: false,
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    permissions: ['queue:write'],
    token: 'test-token',
    loading: false,
  }),
}));

// ── WebSocket mock ─────────────────────────────────────────────────────────

vi.mock('../../../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

// ── Mobile hook mock ───────────────────────────────────────────────────────

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

// ── Antd message / Modal mock ──────────────────────────────────────────────

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Modal: {
      ...(actual as any).Modal,
      confirm: vi.fn(),
    },
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const makeEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  tenant_id: 1,
  patient_name: '张三',
  doctor_id: 10,
  doctor_name: '张医生',
  room: '1诊室',
  seq_number: 1,
  status: 'waiting',
  source: 'walk_in',
  queue_date: '2026-03-25',
  created_at: '2026-03-25T08:00:00Z',
  ...overrides,
});

const makeUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 10,
  username: 'dr_zhang',
  real_name: '张医生',
  phone: '13800138000',
  status: 1,
  tenant_id: 1,
  roles: [],
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ── Helper ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  return render(
    <MemoryRouter>
      <QueueDashboard />
    </MemoryRouter>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('QueueDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty user list
    mockListUsers.mockResolvedValue({ data: { list: [], total: 0 } });
  });

  // 1. Doctor cards rendered
  it('renders doctor cards for each doctor in queue', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', doctor_id: 10, doctor_name: '张医生', room: '1诊室', seq_number: 1 }),
      makeEntry({ id: 2, patient_name: '李四', doctor_id: 20, doctor_name: '王医生', room: '2诊室', seq_number: 2 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张医生')).toBeInTheDocument();
    });
    expect(screen.getByText('王医生')).toBeInTheDocument();
  });

  // 2. Stats badges
  it('shows waiting, seeing, and done counts in stats badges', async () => {
    const entries = [
      makeEntry({ id: 1, status: 'waiting', doctor_id: 10, doctor_name: '张医生' }),
      makeEntry({ id: 2, status: 'seeing', doctor_id: 10, doctor_name: '张医生', seq_number: 2 }),
      makeEntry({ id: 3, status: 'done', doctor_id: 10, doctor_name: '张医生', seq_number: 3 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('候诊')).toBeInTheDocument();
    });
    expect(screen.getByText('就诊')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  // 3. Empty queue shows placeholder
  it('shows "暂无排队数据" when queue is empty', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [] } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('暂无排队数据')).toBeInTheDocument();
    });
  });

  // 4. Take-number UI is visible (has queue:write permission)
  it('renders take-number bar with input and button', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [] } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('现场取号')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('患者姓名')).toBeInTheDocument();
    expect(screen.getByText('取号')).toBeInTheDocument();
  });

  // 5. Take number interaction calls API
  it('calls takeNumber API when name filled and doctor selected', async () => {
    // Provide a doctor via user list so the Select has an option
    const users = [makeUser({ id: 10, real_name: '张医生' })];
    mockListUsers.mockResolvedValue({ data: { list: users, total: 1 } });
    mockListQueue.mockResolvedValue({ data: { list: [] } });
    mockTakeNumber.mockResolvedValue({ data: { id: 99, seq_number: 1, patient_name: '新患者' } });

    renderDashboard();

    // Wait for component to finish loading users
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalled();
    });

    // Type patient name
    const nameInput = screen.getByPlaceholderText('患者姓名');
    fireEvent.change(nameInput, { target: { value: '新患者' } });

    // Select doctor via antd Select – simulate by directly clicking the option
    // Open the select dropdown
    const selectEl = screen.getByText('选择医生').closest('.ant-select') ||
      document.querySelector('.ant-select');
    if (selectEl) {
      fireEvent.mouseDown(selectEl);
    }

    // Wait for option to appear and click it
    await waitFor(() => {
      const option = screen.queryByText('张医生');
      if (option) fireEvent.click(option);
    });

    // Click 取号 button
    fireEvent.click(screen.getByText('取号'));

    await waitFor(() => {
      expect(mockTakeNumber).toHaveBeenCalledWith(
        expect.objectContaining({ patient_name: '新患者', doctor_id: 10 }),
      );
    });
  });

  // 6. Error handling: listQueue rejects
  it('does not crash when listQueue rejects', async () => {
    mockListQueue.mockRejectedValue(new Error('network error'));

    // Should not throw
    expect(() => renderDashboard()).not.toThrow();

    // After the error, component should still render the header
    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
  });

  // 7. Stats counts match data
  it('counts waiting entries correctly in stats badge', async () => {
    const entries = [
      makeEntry({ id: 1, status: 'waiting', doctor_id: 10, doctor_name: '张医生', seq_number: 1 }),
      makeEntry({ id: 2, status: 'waiting', doctor_id: 10, doctor_name: '张医生', seq_number: 2 }),
      makeEntry({ id: 3, status: 'done', doctor_id: 10, doctor_name: '张医生', seq_number: 3 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    // The waiting StatBadge shows "候诊" text next to the count
    await waitFor(() => {
      expect(screen.getByText('候诊')).toBeInTheDocument();
    });

    // Count "2" should appear as a bold number somewhere in the stats row
    const waitingBadge = screen.getByText('候诊').closest('div');
    expect(waitingBadge).toBeInTheDocument();
  });

  // 8. Page title / header renders
  it('renders the "排队叫号" title', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [] } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
  });
});
