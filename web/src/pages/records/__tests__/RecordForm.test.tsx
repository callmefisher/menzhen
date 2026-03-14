import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RecordForm from '../RecordForm';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
    hasPermission: () => true,
  }),
}));

const mockListPatients = vi.fn();
vi.mock('../../../api/patient', () => ({
  listPatients: (...args: unknown[]) => mockListPatients(...args),
  createPatient: vi.fn(),
  getPatient: vi.fn(),
}));

vi.mock('../../../api/record', () => ({
  getRecord: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  getCachedAiAnalysis: vi.fn(),
  saveAiAnalysis: vi.fn(),
}));

vi.mock('../../../api/prescription', () => ({
  listPrescriptionsByRecord: vi.fn(),
  deletePrescription: vi.fn(),
}));

const mockListPulses = vi.fn();
vi.mock('../../../api/pulse', () => ({
  listPulses: (...args: unknown[]) => mockListPulses(...args),
}));

vi.mock('../../../api/upload', () => ({
  uploadFile: vi.fn(),
  getFileUrl: vi.fn(),
}));

vi.mock('../../../utils/sse', () => ({
  streamAiAnalysis: vi.fn(),
  streamTongueAnalysis: vi.fn(),
}));

vi.mock('../../../components/FileUpload', () => ({
  default: () => <div data-testid="file-upload">FileUpload</div>,
}));

vi.mock('../../../components/PrescriptionModal', () => ({
  default: () => null,
}));

vi.mock('../../../components/PrescriptionPrint', () => ({
  default: () => null,
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('remark-gfm', () => ({
  default: () => {},
}));

vi.mock('rehype-raw', () => ({
  default: () => {},
}));

const mockPulseResult = {
  data: {
    list: [
      {
        id: 1,
        name: '弦脉',
        category: '弦脉类',
        description: '脉管紧张如琴弦',
        clinical_meaning: '主肝胆病、痰饮',
        common_conditions: '高血压、肝炎',
        created_at: '2026-01-01',
      },
    ],
    total: 1,
  },
};

describe('RecordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPatients.mockResolvedValue({
      data: {
        list: [
          { id: 1, name: '张三', gender: 1, age: 30, phone: '13800138000', birthday: '1995-01-01' },
        ],
        total: 1,
      },
    });
    mockListPulses.mockResolvedValue({ data: { list: [], total: 0 } });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <RecordForm />
      </MemoryRouter>
    );

  it('renders the record form', { timeout: 15000 }, async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增诊疗记录')).toBeInTheDocument();
    });
  });

  it('searches pulses on button click without auto-search on typing', { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增诊疗记录')).toBeInTheDocument();
    });

    // Type pulse name — should NOT trigger API call
    const pulseInput = screen.getByPlaceholderText('输入脉象名称后点击查询');
    await user.type(pulseInput, '弦脉');
    expect(mockListPulses).not.toHaveBeenCalled();

    // Click the search button next to the pulse input (find by traversing up to the flex container)
    mockListPulses.mockResolvedValueOnce(mockPulseResult);
    const searchBtns = screen.getAllByRole('button', { name: /查询/ });
    // The pulse search button is the one that's not disabled after typing
    const pulseSearchBtn = searchBtns.find(btn => !btn.hasAttribute('disabled'))!;
    await user.click(pulseSearchBtn);

    await waitFor(() => {
      expect(mockListPulses).toHaveBeenCalledWith({ name: '弦脉', page: 1, size: 10 });
    });
  });

  it('shows result tags after search, hides input, and selects on click', { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    mockListPulses.mockResolvedValue(mockPulseResult);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增诊疗记录')).toBeInTheDocument();
    });

    // Type and search
    const pulseInput = screen.getByPlaceholderText('输入脉象名称后点击查询');
    await user.type(pulseInput, '弦脉');
    // Click the search button next to the pulse input
    const searchBtns2 = screen.getAllByRole('button', { name: /查询/ });
    await user.click(searchBtns2.find(btn => !btn.hasAttribute('disabled'))!);

    // Result tags appear, input hidden
    await waitFor(() => {
      expect(screen.getByText('弦脉 (弦脉类)')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('输入脉象名称后点击查询')).not.toBeInTheDocument();
    });

    // Click result tag to select
    await user.click(screen.getByText('弦脉 (弦脉类)'));

    // Detail card shows info
    await waitFor(() => {
      expect(screen.getByText(/脉管紧张如琴弦/)).toBeInTheDocument();
    });
  });

  it('clears pulse selection when tag is closed', { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    mockListPulses.mockResolvedValue(mockPulseResult);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增诊疗记录')).toBeInTheDocument();
    });

    // Search and select
    const pulseInput = screen.getByPlaceholderText('输入脉象名称后点击查询');
    await user.type(pulseInput, '弦脉');
    const searchBtns3 = screen.getAllByRole('button', { name: /查询/ });
    await user.click(searchBtns3.find(btn => !btn.hasAttribute('disabled'))!);
    await waitFor(() => {
      expect(screen.getByText('弦脉 (弦脉类)')).toBeInTheDocument();
    });
    await user.click(screen.getByText('弦脉 (弦脉类)'));

    await waitFor(() => {
      expect(screen.getByText(/脉管紧张如琴弦/)).toBeInTheDocument();
    });

    // Close the tag
    const tagCloseIcon = document.querySelector('.ant-tag .anticon-close');
    expect(tagCloseIcon).toBeTruthy();
    await user.click(tagCloseIcon as Element);

    // Search input should reappear
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入脉象名称后点击查询')).toBeInTheDocument();
    });
    expect(screen.queryByText(/脉管紧张如琴弦/)).not.toBeInTheDocument();
  });
});
