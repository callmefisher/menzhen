import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueueStrip from '../QueueStrip';

// ── API mocks ──────────────────────────────────────────────────────────────
vi.mock('../../api/queue', () => ({
  listQueue: vi.fn(),
  completeVisit: vi.fn(),
  callNumber: vi.fn(),
}));
vi.mock('../../api/queue-doctor', () => ({
  getShowArrivalTime: vi.fn().mockResolvedValue({ data: { show: false } }),
}));

// ── Hook / store mocks ─────────────────────────────────────────────────────
vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }));
vi.mock('../../store/auth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('../../hooks/useIsMobile', () => ({ default: () => false }));
vi.mock('../../hooks/useQueueDoctorId', () => ({ useQueueDoctorId: () => 1 }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../utils/format', () => ({ formatQueueTime: (t: string) => t }));

import { listQueue, callNumber, completeVisit } from '../../api/queue';
const mockListQueue = listQueue as ReturnType<typeof vi.fn>;
const mockCallNumber = callNumber as ReturnType<typeof vi.fn>;
const mockCompleteVisit = completeVisit as ReturnType<typeof vi.fn>;

// ── Shared fixtures ────────────────────────────────────────────────────────
const makeEntry = (overrides: Partial<{
  id: number; seq_number: number; status: string;
  patient_name: string; source: string; checkin_status: string;
  patient_id: number | null; arrival_time: string | null;
}>) => ({
  id: 1, seq_number: 1, status: 'waiting',
  patient_name: '张三', source: 'walk-in', checkin_status: 'pending',
  patient_id: null, arrival_time: null,
  ...overrides,
});

function mockQueue(entries: ReturnType<typeof makeEntry>[]) {
  mockListQueue.mockResolvedValue({ data: { list: entries } });
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('QueueStrip — handleCall loading feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteVisit.mockResolvedValue({});
  });

  it('renders null when queue is empty', async () => {
    mockQueue([]);
    const { container } = render(<QueueStrip />);
    await waitFor(() => expect(mockListQueue).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows 叫号 button for a ready waiting entry', async () => {
    mockCallNumber.mockResolvedValue({});
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    render(<QueueStrip />);
    expect(await screen.findByText('叫号')).toBeInTheDocument();
  });

  it('shows 再叫 button for a seeing entry', async () => {
    mockCallNumber.mockResolvedValue({});
    mockQueue([makeEntry({ id: 2, status: 'seeing' })]);
    render(<QueueStrip />);
    expect(await screen.findByText('再叫')).toBeInTheDocument();
  });

  it('calls callNumber once when 叫号 is clicked and shows success toast', async () => {
    mockCallNumber.mockResolvedValue({});
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    const { message } = await import('antd');
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => ({ then: vi.fn() } as unknown as ReturnType<typeof message.success>));
    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');
    await userEvent.click(btn);
    await waitFor(() => expect(mockCallNumber).toHaveBeenCalledWith(1));
    expect(mockCallNumber).toHaveBeenCalledTimes(1);
    expect(successSpy).toHaveBeenCalledWith('已叫号');
    successSpy.mockRestore();
  });

  it('calls callNumber once when 再叫 is clicked and shows success toast', async () => {
    mockCallNumber.mockResolvedValue({});
    mockQueue([makeEntry({ id: 2, status: 'seeing' })]);
    const { message } = await import('antd');
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => ({ then: vi.fn() } as unknown as ReturnType<typeof message.success>));
    render(<QueueStrip />);
    const btn = await screen.findByText('再叫');
    await userEvent.click(btn);
    await waitFor(() => expect(mockCallNumber).toHaveBeenCalledWith(2));
    expect(mockCallNumber).toHaveBeenCalledTimes(1);
    expect(successSpy).toHaveBeenCalledWith('已叫号');
    successSpy.mockRestore();
  });

  it('shows loading state on 叫号 button during API call', async () => {
    let resolve!: () => void;
    mockCallNumber.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');

    act(() => { userEvent.click(btn); });

    // AntD renders loading as aria-busy or adds a LoadingOutlined — query by role
    await waitFor(() => {
      const loadingIcon = document.querySelector('.ant-btn-loading');
      expect(loadingIcon).not.toBeNull();
    });

    await act(async () => { resolve(); });

    await waitFor(() => {
      expect(document.querySelector('.ant-btn-loading')).toBeNull();
    });
  });

  it('prevents double-click: second click while in-flight is ignored', async () => {
    let resolve!: () => void;
    mockCallNumber.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');

    // First click — starts the async call, does NOT await so callingId is set
    userEvent.click(btn);

    // Wait until callNumber has been called (callingId is now set)
    await waitFor(() => expect(mockCallNumber).toHaveBeenCalledTimes(1));

    // Second click while first is still in flight — should be a no-op
    await userEvent.click(btn);

    // Still only called once
    expect(mockCallNumber).toHaveBeenCalledTimes(1);

    // Clean up: resolve the pending promise
    await act(async () => { resolve(); });
  });

  it('shows message.error on callNumber failure', async () => {
    mockCallNumber.mockRejectedValue(new Error('network'));
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);

    // Spy on message.error via antd's global message
    const { message } = await import('antd');
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => ({ then: vi.fn() } as unknown as ReturnType<typeof message.error>));

    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');
    await userEvent.click(btn);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('叫号失败'));
    errorSpy.mockRestore();
  });

  it('loading clears after callNumber resolves', async () => {
    mockCallNumber.mockResolvedValue({});
    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    const { message } = await import('antd');
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => ({ then: vi.fn() } as unknown as ReturnType<typeof message.success>));
    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');
    await userEvent.click(btn);
    await waitFor(() => expect(document.querySelector('.ant-btn-loading')).toBeNull());
    successSpy.mockRestore();
  });

  it('loading clears after callNumber rejects', async () => {
    mockCallNumber.mockRejectedValue(new Error('fail'));
    const { message } = await import('antd');
    vi.spyOn(message, 'error').mockImplementation(() => ({ then: vi.fn() } as unknown as ReturnType<typeof message.error>));

    mockQueue([makeEntry({ id: 1, status: 'waiting' })]);
    render(<QueueStrip />);
    const btn = await screen.findByText('叫号');
    await userEvent.click(btn);
    await waitFor(() => expect(mockCallNumber).toHaveBeenCalled());
    expect(document.querySelector('.ant-btn-loading')).toBeNull();
  });
});
