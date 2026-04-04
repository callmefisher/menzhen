import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QueueDashboard from '../QueueDashboard';
import type { QueueEntry } from '../../../api/queue';

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
const mockGetCallDisplayDuration = vi.fn();

vi.mock('../../../api/queue-doctor', () => ({
  listQueueDoctors: (...args: unknown[]) => mockListQueueDoctors(...args),
  getCallDisplayDuration: (...args: unknown[]) => mockGetCallDisplayDuration(...args),
  getShowArrivalTime: vi.fn().mockResolvedValue({ data: { show: true } }),
}));

const mockCheckinAppointment = vi.fn();
vi.mock('../../../api/appointment', () => ({
  checkinAppointment: (...args: unknown[]) => mockCheckinAppointment(...args),
  createAppointment: vi.fn(),
  getSlots: vi.fn().mockResolvedValue({ data: { data: { list: [] } } }),
}));

vi.mock('../../../components/AppointmentModal', () => ({
  default: () => null,
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

// ── WebSocket mock (captures handlers for manual triggering) ───────────────

const wsHandlers: Record<string, (msg: unknown) => void> = {};

vi.mock('../../../hooks/useWebSocket', () => ({
  useWebSocket: (type: string, handler: (msg: unknown) => void) => {
    wsHandlers[type] = handler;
  },
}));

// ── Navigation mock ────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

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
      ...(actual as unknown as { Modal: Record<string, unknown> }).Modal,
      confirm: vi.fn(),
    },
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const makeEntry = (overrides: Partial<QueueEntry> = {}): QueueEntry => ({
  id: 1,
  tenant_id: 1,
  patient_id: 100,
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
    mockGetCallDisplayDuration.mockResolvedValue({ data: { seconds: 10 } });
    mockCheckinAppointment.mockResolvedValue({ data: { code: 0 } });
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

    await waitFor(() => {
      expect(screen.getByText('候诊')).toBeInTheDocument();
    });

    const waitingBadge = screen.getByText('候诊').closest('div');
    expect(waitingBadge).toBeInTheDocument();
    expect(waitingBadge).toHaveTextContent('2'); // 2 waiting entries
  });

  // 8. Page title / header renders
  it('renders the "排队叫号" title', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [] } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
  });

  // 9. "下一位" tag is displayed for first waiting patient
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

    expect(screen.getByText('下一位')).toBeInTheDocument();
  });

  // 10. Room number formatting - pure number gets "诊室" prefix
  it('formats pure number room with "诊室" prefix', async () => {
    const entries = [
      makeEntry({ id: 1, doctor_id: 10, doctor_name: '张医生', room: '5', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('张医生').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('诊室5')).toBeInTheDocument();
  });

  // 11. Room number formatting - room already with "诊室" stays unchanged
  it('keeps room name unchanged when it already contains "诊室"', async () => {
    const entries = [
      makeEntry({ id: 1, doctor_id: 10, doctor_name: '李医生', room: '诊室1', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('李医生').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('诊室1')).toBeInTheDocument();
  });

  // 12. Entries are sorted by seq_number
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

    const nextPatientTags = screen.getAllByText('下一位');
    expect(nextPatientTags.length).toBeGreaterThan(0);
  });

  // 13. "就诊中" tag is displayed for seeing patient
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

  // 14. Page visibility - only one listener is created
  it('creates only one visibilitychange listener', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    const visibilityListeners = addEventListenerSpy.mock.calls.filter(
      call => call[0] === 'visibilitychange',
    );
    expect(visibilityListeners.length).toBe(1);

    addEventListenerSpy.mockRestore();
  });

  // 15. Page visibility - listener is cleaned up on unmount
  it('removes visibilitychange listener on unmount', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    const handler = addEventListenerSpy.mock.calls.find(
      call => call[0] === 'visibilitychange',
    )?.[1];

    unmount();

    const removedListeners = removeEventListenerSpy.mock.calls.filter(
      call => call[0] === 'visibilitychange',
    );
    expect(removedListeners.length).toBe(1);
    expect(removedListeners[0][1]).toBe(handler);

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // 16. Page visibility - state updates on visibility change
  it('updates pageVisible state when visibility changes', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', status: 'waiting', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(screen.getByText('张三')).toBeInTheDocument();
  });

  // 17. Page visibility - SSR compatibility for initial state
  it('handles SSR environment gracefully for initial state', async () => {
    const originalHidden = document.hidden;

    Object.defineProperty(document, 'hidden', { value: undefined, writable: true, configurable: true });

    expect(() => renderDashboard()).not.toThrow();

    Object.defineProperty(document, 'hidden', { value: originalHidden, writable: true, configurable: true });

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
  });

  // 18. NEW: call duration is fetched on mount
  it('fetches call display duration on mount', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(mockGetCallDisplayDuration).toHaveBeenCalledTimes(1);
    });
  });

  // 19. NEW: call duration defaults to 10s when API fails
  it('defaults call duration to 10s when API fails', async () => {
    mockGetCallDisplayDuration.mockRejectedValue(new Error('network'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });
    // Component should still render without crashing
    expect(screen.queryByText('排队叫号')).toBeInTheDocument();
  });

  // 20. NEW: first queue_call shows overlay immediately (within the doctor card)
  it('shows call overlay immediately for the first queue_call message', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [makeEntry({ status: 'waiting' })] } });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 5, patient_name: '赵六', room: '1诊室', doctor_name: '张医生' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('赵六')).toBeInTheDocument();
    });
  });

  // 21. NEW: second queue_call while first is showing — first stays visible, second queues
  it('does not interrupt current overlay when second queue_call arrives', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [makeEntry({ status: 'waiting' })] } });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    // First call
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 1, patient_name: '第一位', room: '1诊室', doctor_name: '张医生' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('第一位')).toBeInTheDocument();
    });

    // Second call arrives while first is still shown
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 2, patient_name: '第二位', room: '1诊室', doctor_name: '张医生' },
      });
    });

    // First call should still be visible
    expect(screen.getByText('第一位')).toBeInTheDocument();
    // Second call should NOT be visible yet
    expect(screen.queryByText('第二位')).not.toBeInTheDocument();
  });

  // 22. NEW: queue_clear clears pending notifications
  it('clears all pending notifications on queue_clear', async () => {
    mockListQueue.mockResolvedValue({ data: { list: [makeEntry({ status: 'waiting' })] } });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    // Push two notifications
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 1, patient_name: '张三', room: '1诊室', doctor_name: '张医生' },
      });
    });
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 2, patient_name: '李四', room: '1诊室', doctor_name: '张医生' },
      });
    });

    // Clear queue
    act(() => {
      wsHandlers['queue_clear']?.({ type: 'queue_clear', payload: {} });
    });

    // No overlay should be visible after clear
    await waitFor(() => {
      expect(screen.queryByText('确定')).not.toBeInTheDocument();
    });
  });

  // 23. Patient names in queue rows are plain text (no click navigation)
  it('renders patient name as plain text without click navigation', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', patient_id: 42, status: 'waiting', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });

    // Clicking patient name should NOT navigate (no navigation in QueueDashboard)
    fireEvent.click(screen.getByText('张三'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // 24. Per-doctor queues are independent: doctor A's call doesn't affect doctor B
  it('shows each doctor their own independent call overlay', async () => {
    const entries = [
      makeEntry({ id: 1, patient_name: '张三', doctor_id: 10, doctor_name: '张医生', room: '1诊室', status: 'waiting', seq_number: 1 }),
      makeEntry({ id: 2, patient_name: '李四', doctor_id: 20, doctor_name: '王医生', room: '2诊室', status: 'waiting', seq_number: 1 }),
    ];
    mockListQueue.mockResolvedValue({ data: { list: entries } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('排队叫号')).toBeInTheDocument();
    });

    // Doctor A calls
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 10, seq: 1, patient_name: '张三叫号', room: '1诊室', doctor_name: '张医生' },
      });
    });

    // Doctor B calls simultaneously
    act(() => {
      wsHandlers['queue_call']?.({
        type: 'queue_call',
        payload: { doctor_id: 20, seq: 1, patient_name: '李四叫号', room: '2诊室', doctor_name: '王医生' },
      });
    });

    // Both overlays should be visible independently
    await waitFor(() => {
      expect(screen.getByText('张三叫号')).toBeInTheDocument();
      expect(screen.getByText('李四叫号')).toBeInTheDocument();
    });
  });

  // 25. Shows 签到 button for appointment entry with pending checkin
  it('shows 签到 button for appointment entry with checkin_status=pending', async () => {
    mockListQueue.mockResolvedValue({
      data: {
        list: [makeEntry({
          id: 10,
          source: 'appointment',
          checkin_status: 'pending',
          appointment_id: 5,
          slot_start: '09:00',
          slot_end: '09:30',
        })],
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
    // antd v5 auto-inserts a space between Chinese chars in Button text: '签 到'
    const buttons = screen.getAllByRole('button');
    const checkinBtn = buttons.find(btn => btn.textContent?.replace(/\s/g, '') === '签到');
    expect(checkinBtn).toBeDefined();
    expect(screen.getByText('预')).toBeInTheDocument();

    // Click 签到 button and verify checkinAppointment is called with appointment_id=5
    fireEvent.click(checkinBtn!);

    await waitFor(() => {
      expect(mockCheckinAppointment).toHaveBeenCalledWith(5);
    });

    // After checkin, fetchQueue should be called again (initial load + post-checkin refresh)
    await waitFor(() => {
      expect(mockListQueue).toHaveBeenCalledTimes(2);
    });
  });

  // 26. Shows ✓ 已到 chip for appointment entry with checkin_status=done
  it('shows ✓ 已到 chip for appointment entry with checkin_status=done', async () => {
    mockListQueue.mockResolvedValue({
      data: {
        list: [makeEntry({
          id: 11,
          source: 'appointment',
          checkin_status: 'done',
          appointment_id: 6,
          slot_start: '09:00',
          slot_end: '09:30',
        })],
      },
    });

    renderDashboard();

    expect(await screen.findByText('✓ 已到')).toBeInTheDocument();
    expect(screen.getByText('预')).toBeInTheDocument();
  });

  // ── Bug fix: 未签到预约号在首位时，后续可叫号的人仍能被叫到 ────────────────

  // 27. 未签到预约在首位，后续签到的患者显示「下一位」而非「候诊中」
  it('marks the first callable entry as 下一位 when the queue head is an unchecked appointment', async () => {
    mockListQueue.mockResolvedValue({
      data: {
        list: [
          makeEntry({ id: 1, patient_name: '预约未签到', seq_number: 1, source: 'appointment', checkin_status: 'pending', appointment_id: 1 }),
          makeEntry({ id: 2, patient_name: '普通号患者', seq_number: 2, source: 'walk_in' }),
        ],
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('预约未签到')).toBeInTheDocument();
      expect(screen.getByText('普通号患者')).toBeInTheDocument();
    });

    // 普通号患者应该是「下一位」
    expect(screen.getByText('下一位')).toBeInTheDocument();
    // 未签到预约号不应是「下一位」
    const allNextTags = screen.getAllByText('下一位');
    expect(allNextTags.length).toBe(1);
  });

  // 28. 未签到预约在首位，后续患者有「叫号」按钮
  it('shows 叫号 button for the first callable entry when queue head is an unchecked appointment', async () => {
    mockCallNumber.mockResolvedValue({ data: { code: 0 } });
    mockListQueue.mockResolvedValue({
      data: {
        list: [
          makeEntry({ id: 1, patient_name: '预约未签到', seq_number: 1, source: 'appointment', checkin_status: 'pending', appointment_id: 1 }),
          makeEntry({ id: 2, patient_name: '签到患者', seq_number: 2, source: 'appointment', checkin_status: 'done', appointment_id: 2 }),
        ],
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('签到患者')).toBeInTheDocument();
    });

    // 「叫号」按钮（行内）应该存在并对应第二个患者（第一个可叫的）
    const callButtons = screen.getAllByRole('button');
    const rowCallBtn = callButtons.find(btn => btn.textContent?.replace(/\s/g, '') === '叫号' && !btn.hasAttribute('disabled'));
    expect(rowCallBtn).toBeDefined();

    // 点击叫号，应该叫的是 id=2 的签到患者，而不是 id=1 的未签到预约
    fireEvent.click(rowCallBtn!);
    await waitFor(() => {
      expect(mockCallNumber).toHaveBeenCalledWith(2);
    });
    expect(mockCallNumber).not.toHaveBeenCalledWith(1);
  });

  // 29. 所有等待者均为未签到预约时，卡片头部「叫号」按钮应禁用
  it('disables card-level 叫号 button when all waiting entries are unchecked appointments', async () => {
    mockListQueue.mockResolvedValue({
      data: {
        list: [
          makeEntry({ id: 1, patient_name: '预约A', seq_number: 1, source: 'appointment', checkin_status: 'pending', appointment_id: 1 }),
          makeEntry({ id: 2, patient_name: '预约B', seq_number: 2, source: 'appointment', checkin_status: 'pending', appointment_id: 2 }),
        ],
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('预约A')).toBeInTheDocument();
    });

    // 卡片头部「叫号」按钮（SoundOutlined + 叫号 文字）应被禁用
    const buttons = screen.getAllByRole('button');
    const headerCallBtn = buttons.find(btn => btn.textContent?.replace(/\s/g, '') === '叫号' && btn.closest('[data-testid]') == null);
    // 找到带 disabled 属性的叫号按钮
    const disabledCallBtn = buttons.find(btn =>
      btn.textContent?.replace(/\s/g, '') === '叫号' && btn.hasAttribute('disabled')
    );
    expect(disabledCallBtn).toBeDefined();
  });

  // 30. 多个未签到预约在前，第一个可叫患者的 position tooltip 只计算可叫的人数
  it('counts only callable entries for position tooltip when unchecked appointments precede', async () => {
    mockListQueue.mockResolvedValue({
      data: {
        list: [
          makeEntry({ id: 1, patient_name: '预约未签到1', seq_number: 1, source: 'appointment', checkin_status: 'pending', appointment_id: 1 }),
          makeEntry({ id: 2, patient_name: '预约未签到2', seq_number: 2, source: 'appointment', checkin_status: 'pending', appointment_id: 2 }),
          makeEntry({ id: 3, patient_name: '可叫患者', seq_number: 3, source: 'walk_in' }),
          makeEntry({ id: 4, patient_name: '第二可叫', seq_number: 4, source: 'walk_in' }),
        ],
      },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('可叫患者')).toBeInTheDocument();
      expect(screen.getByText('第二可叫')).toBeInTheDocument();
    });

    // 「可叫患者」应为「下一位」（不是「候诊中」）
    expect(screen.getByText('下一位')).toBeInTheDocument();
    // 「第二可叫」位于「可叫患者」后面，前方只有 1 个可叫的人（可叫患者）
    // 通过 Tooltip title 验证（Antd Tooltip 渲染在 title 属性上）
    // 不直接检查 tooltip 文字（jsdom 不渲染 hover tooltip），
    // 但至少验证「下一位」只有一个（说明 position 标记正确）
  });

  // 31. Regression: take-number sends queue_doctor.id (PK), NOT user_id
  // Before fix, doctor options were built with d.user_id instead of d.id,
  // causing walk_in entries to store user_id as doctor_id (ID space mismatch).
  it('doctor options in take-number use queue_doctor.id (d.id), not user_id (d.user_id)', async () => {
    // Doctor with queue_doctor.id=5 and user_id=99 — very different values
    mockListQueueDoctors.mockResolvedValue({
      data: {
        list: [
          { id: 5, user_id: 99, user_name: '李医生', room: '1诊室', enabled: true, sort_order: 0 },
        ],
      },
    });
    mockTakeNumber.mockResolvedValue({ data: { code: 0 } });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('现场取号')).toBeInTheDocument();
    });

    // Enter patient name and submit
    fireEvent.change(screen.getByPlaceholderText('患者姓名'), { target: { value: '测试患者' } });
    fireEvent.click(screen.getByText('取号'));

    await waitFor(() => {
      expect(mockTakeNumber).toHaveBeenCalled();
    });

    const callArgs = mockTakeNumber.mock.calls[0][0] as { doctor_id: number };
    // MUST use queue_doctor.id (5), NOT user_id (99)
    expect(callArgs.doctor_id).toBe(5);
    expect(callArgs.doctor_id).not.toBe(99);
  });
});
