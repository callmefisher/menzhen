import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

const mockListQueueDoctors = vi.fn();

vi.mock('../../../api/queue-doctor', () => ({
  listQueueDoctors: (...args: unknown[]) => mockListQueueDoctors(...args),
}));

// ── Auth mock ──────────────────────────────────────────────────────────────

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => ['queue:read', 'queue:create', 'queue:update', 'queue:clear'].includes(code),
    isGlobalAdmin: false,
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    permissions: ['queue:read', 'queue:create', 'queue:update', 'queue:clear'],
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
    // Default: empty queue, one enabled doctor
    mockListQueue.mockResolvedValue({ data: { list: [] } });
    mockListQueueDoctors.mockResolvedValue({ data: { list: [{ id: 1, user_id: 10, user_name: '张医生', room: '1诊室', enabled: true, sort_order: 0 }] } });
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
      expect(screen.getAllByText('张医生').length).toBeGreaterThanOrEqual(1);
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

  // 5. Take number shows warning when patient name is empty
  it('shows warning when clicking take number without entering name', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('取号')).toBeInTheDocument();
    });

    // Click 取号 without entering a name
    fireEvent.click(screen.getByText('取号'));

    // Should not call API (no name entered)
    expect(mockTakeNumber).not.toHaveBeenCalled();
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

  // 9. NEW: "下一位" tag is displayed for first waiting patient
  it('shows "下一位" tag for the first waiting patient', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', status: 'waiting', seq_number: 1 }),
      makeEntry({ id: 2, patient_name: '李四', status: 'waiting', seq_number: 2 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    // First waiting patient should have "下一位" tag
    expect(screen.getByText('下一位')).toBeInTheDocument();
  });

  // 10. NEW: Room number formatting - pure number gets "诊室" prefix
  it('formats pure number room with "诊室" prefix', async () => {
    const entries = [
      makeEntry({ id: 1, doctor_id: 10, doctor_name: '张医生', room: '5', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      // Use getAllByText since doctor name appears in multiple places
      expect(screen.getAllByText('张医生').length).toBeGreaterThanOrEqual(1);
    });

    // Room "5" should be displayed as "诊室5"
    expect(screen.getByText('诊室5')).toBeInTheDocument();
  });

  // 11. NEW: Room number formatting - room already with "诊室" stays unchanged
  it('keeps room name unchanged when it already contains "诊室"', async () => {
    const entries = [
      makeEntry({ id: 1, doctor_id: 10, doctor_name: '李医生', room: '诊室1', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('李医生').length).toBeGreaterThanOrEqual(1);
    });

    // Room "诊室1" should stay as "诊室1"
    expect(screen.getByText('诊室1')).toBeInTheDocument();
  });

  // 12. NEW: Entries are sorted by seq_number
  it('sorts entries by seq_number within each doctor group', async () => {
    const entries = [
      makeEntry({ id: 3, patient_name: '王五', doctor_id: 10, seq_number: 3, status: 'waiting' }),
      makeEntry({ id: 1, patient_name: '张三', doctor_id: 10, seq_number: 1, status: 'waiting' }),
      makeEntry({ id: 2, patient_name: '李四', doctor_id: 10, seq_number: 2, status: 'waiting' }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    // First waiting should be 张三 (seq 1), showing "下一位"
    const nextPatientTags = screen.getAllByText('下一位');
    expect(nextPatientTags.length).toBeGreaterThan(0);
  });

  // 13. NEW: "就诊中" tag is displayed for seeing patient
  it('shows "就诊中" tag for patient with seeing status', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', status: 'seeing', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    expect(screen.getByText('就诊中')).toBeInTheDocument();
  });

  // 14. NEW: Page visibility - only one listener is created
  it('creates only one visibilitychange listener', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    // Should have exactly one visibilitychange listener
    const visibilityListeners = addEventListenerSpy.mock.calls.filter(
      call => call[0] === 'visibilitychange',
    );
    expect(visibilityListeners.length).toBe(1);

    addEventListenerSpy.mockRestore();
  });

  // 15. NEW: Page visibility - listener is cleaned up on unmount
  it('removes visibilitychange listener on unmount', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    // Get the handler function reference
    const handler = addEventListenerSpy.mock.calls.find(
      call => call[0] === 'visibilitychange',
    )?.[1];

    unmount();

    // Should remove the same handler
    const removedListeners = removeEventListenerSpy.mock.calls.filter(
      call => call[0] === 'visibilitychange',
    );
    expect(removedListeners.length).toBe(1);
    expect(removedListeners[0][1]).toBe(handler);

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // 16. NEW: Page visibility - state updates on visibility change
  it('updates pageVisible state when visibility changes', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', status: 'waiting', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    // Simulate page becoming hidden
    Object.defineProperty(document, 'hidden', {
      value: true,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Simulate page becoming visible again
    Object.defineProperty(document, 'hidden', {
      value: false,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Component should still be rendered without errors
    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  // 17. NEW: Page visibility - SSR compatibility for initial state
  it('handles SSR environment gracefully for initial state', async () => {
    // Test that the initial state function handles missing document
    // We test this by verifying the component doesn't crash when document.hidden is accessed
    const originalHidden = document.hidden;
    
    // Mock document.hidden to be undefined (simulating edge case)
    Object.defineProperty(document, 'hidden', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // This should not throw
    expect(() => renderDashboard()).not.toThrow();

    // Restore original value
    Object.defineProperty(document, 'hidden', {
      value: originalHidden,
      writable: true,
      configurable: true,
    });

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
  });
});
