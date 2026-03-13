import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../../api/pulse', () => ({
  listPulses: vi.fn().mockResolvedValue({ data: { list: [], total: 0 } }),
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
});
