import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PatientList from '../PatientList';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

const mockListPatients = vi.fn();
const mockDeletePatient = vi.fn();

vi.mock('../../../api/patient', () => ({
  listPatients: (...args: unknown[]) => mockListPatients(...args),
  deletePatient: (...args: unknown[]) => mockDeletePatient(...args),
  findPatientPage: vi.fn().mockResolvedValue(1),
}));

vi.mock('../PatientForm', () => ({
  PatientFormModal: () => null,
}));

vi.mock('../../../api/queue', () => ({
  listQueue: vi.fn().mockResolvedValue({ data: { list: [] } }),
  completeVisit: vi.fn(),
}));

vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'test', real_name: 'Test', tenant_id: 1 },
    permissions: [],
    token: 'test-token',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    hasPermission: () => false,
    isGlobalAdmin: false,
  }),
}));

vi.mock('../../../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

describe('PatientList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPatientList = () =>
    render(
      <MemoryRouter>
        <PatientList />
      </MemoryRouter>
    );

  it('renders patient list and shows data', async () => {
    mockListPatients.mockResolvedValue({
      data: {
        list: [
          { id: 1, name: '张三', gender: 1, age: 30, phone: '13800138000', birthday: '1995-01-01', weight: 70, id_card: '', address: '北京', native_place: '', notes: '', created_at: '2025-01-01' },
          { id: 2, name: '李四', gender: 2, age: 25, phone: '13900139000', birthday: '2000-05-15', weight: 55, id_card: '', address: '上海', native_place: '', notes: '', created_at: '2025-01-02' },
        ],
        total: 2,
      },
    });

    renderPatientList();

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('共 2 条记录')).toBeInTheDocument();
  });

  it('renders empty state when no patients', async () => {
    mockListPatients.mockResolvedValue({
      data: {
        list: [],
        total: 0,
      },
    });

    renderPatientList();

    await waitFor(() => {
      expect(screen.getByText('暂无患者记录')).toBeInTheDocument();
    });
  });

  it('handles search by name', async () => {
    mockListPatients.mockResolvedValue({
      data: {
        list: [
          { id: 1, name: '张三', gender: 1, age: 30, phone: '13800138000', birthday: '1995-01-01', weight: 70, id_card: '', address: '', native_place: '', notes: '', created_at: '2025-01-01' },
        ],
        total: 1,
      },
    });

    const user = userEvent.setup();
    renderPatientList();

    // Wait for initial load
    await waitFor(() => {
      expect(mockListPatients).toHaveBeenCalledTimes(1);
    });

    const searchInput = screen.getByPlaceholderText('搜索患者姓名');
    await user.type(searchInput, '张三');
    await user.click(screen.getByText('搜索'));

    await waitFor(() => {
      expect(mockListPatients).toHaveBeenCalledWith(
        expect.objectContaining({ name: '张三', page: 1 })
      );
    });
  });
});
