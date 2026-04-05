import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PatientQueue from '../patient/PatientQueue';

// ── WS handler registry (simulate usePatientWebSocket) ──────────────────────
type WSHandler = (msg: unknown) => void;
const wsHandlers = new Map<string, WSHandler>();

vi.mock('../../hooks/usePatientWebSocket', () => ({
  usePatientWebSocket: (type: string, handler: WSHandler) => {
    wsHandlers.set(type, handler);
  },
}));

// ── API mocks ─────────────────────────────────────────────────────────────────
const mockTakeQueueNumber = vi.fn();
const mockGetMyQueueStatus = vi.fn();
const mockListDoctors = vi.fn();
const mockListPatientQueue = vi.fn();

vi.mock('../../api/patientPortal', () => ({
  takeQueueNumber: (...a: unknown[]) => mockTakeQueueNumber(...a),
  getMyQueueStatus: () => mockGetMyQueueStatus(),
  listDoctors: () => mockListDoctors(),
  listPatientQueue: (...a: unknown[]) => mockListPatientQueue(...a),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

// ── CallOverlay mock (tracks visible prop) ───────────────────────────────────
let lastOverlayProps: { visible: boolean; seq: number; name: string; room: string; doctor: string; onClose: () => void } | null = null;

vi.mock('../../components/CallOverlay', () => ({
  default: (props: typeof lastOverlayProps) => {
    lastOverlayProps = props;
    if (!props?.visible) return null;
    return (
      <div data-testid="call-overlay">
        <span data-testid="overlay-seq">{props.seq}</span>
        <span data-testid="overlay-name">{props.name}</span>
        <button onClick={props?.onClose}>确定</button>
      </div>
    );
  },
}));

// ── SpeechSynthesis mock ─────────────────────────────────────────────────────
const mockSpeechSynthesis = {
  resume: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
  getVoices: vi.fn().mockReturnValue([]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  volume = 1;
  constructor(text: string) { this.text = text; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQueueEntry(overrides = {}) {
  return {
    id: 1,
    seq_number: 3,
    doctor_id: 10,
    doctor_name: '张医生',
    patient_name: '李四',
    room: '1',
    status: 'waiting',
    ...overrides,
  };
}

function simulateQueueCall(payload: object) {
  const handler = wsHandlers.get('queue_call');
  if (handler) act(() => handler({ type: 'queue_call', payload }));
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  wsHandlers.clear();
  lastOverlayProps = null;
  vi.clearAllMocks();
  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    value: mockSpeechSynthesis,
  });
  // @ts-expect-error jsdom doesn't have SpeechSynthesisUtterance
  window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

  // Default: no active queue
  mockGetMyQueueStatus.mockResolvedValue({ data: null });
  mockListDoctors.mockResolvedValue({ data: [] });
  mockListPatientQueue.mockResolvedValue({ data: [] });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PatientQueue — queue_call 弹窗', () => {
  it('当叫到自己的号码时显示 CallOverlay', async () => {
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 2 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' });

    await waitFor(() => expect(screen.getByTestId('call-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('overlay-seq').textContent).toBe('3');
    expect(screen.getByTestId('overlay-name').textContent).toBe('李四');
  });

  it('叫号不是自己时不显示弹窗', async () => {
    const entry = makeQueueEntry({ seq_number: 3 });
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 1 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    simulateQueueCall({ seq: 7, patient_name: '王五', room: '2', doctor_name: '张医生' });

    await waitFor(() => expect(lastOverlayProps?.visible).toBeFalsy());
    expect(screen.queryByTestId('call-overlay')).not.toBeInTheDocument();
  });

  it('payload 格式错误时不崩溃也不显示弹窗', async () => {
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 0 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    // malformed payload — no seq field
    simulateQueueCall({ patient_name: '李四' });

    await waitFor(() => expect(lastOverlayProps?.visible).toBeFalsy());
  });

  it('点击确定后弹窗关闭', async () => {
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 1 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' });
    await waitFor(() => expect(screen.getByTestId('call-overlay')).toBeInTheDocument());

    await userEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(screen.queryByTestId('call-overlay')).not.toBeInTheDocument());
  });

  it('未取号时（myEntry 为 null）收到 queue_call 不显示弹窗', async () => {
    mockGetMyQueueStatus.mockResolvedValue({ data: null });
    mockListDoctors.mockResolvedValue({ data: [{ id: 1, doctor_name: '张医生', room: '1' }] });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('快捷取号')).toBeInTheDocument());

    simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' });

    // Give time for any state update
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('call-overlay')).not.toBeInTheDocument();
  });
});

describe('PatientQueue — TTS 语音播报', () => {
  it('叫到自己时触发 speechSynthesis.speak', async () => {
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 0 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    vi.useFakeTimers();
    simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' });
    act(() => vi.advanceTimersByTime(150));
    vi.useRealTimers();

    expect(mockSpeechSynthesis.resume).toHaveBeenCalled();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    // speak may receive a MockSpeechSynthesisUtterance instance
    expect(mockSpeechSynthesis.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('请') })
    );
  });

  it('弹窗关闭时调用 speechSynthesis.cancel', async () => {
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 0 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' });
    await waitFor(() => expect(screen.getByTestId('call-overlay')).toBeInTheDocument());

    mockSpeechSynthesis.cancel.mockClear();
    await userEvent.click(screen.getByText('确定'));

    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it('不支持 speechSynthesis 时不崩溃', async () => {
    Object.defineProperty(window, 'speechSynthesis', { writable: true, value: undefined });
    const entry = makeQueueEntry();
    mockGetMyQueueStatus.mockResolvedValue({ data: { queue_entry: entry, waiting_ahead: 0 } });

    render(<PatientQueue />);
    await waitFor(() => expect(screen.queryByText('您的号码')).toBeInTheDocument());

    expect(() => simulateQueueCall({ seq: 3, patient_name: '李四', room: '1', doctor_name: '张医生' })).not.toThrow();
  });
});
