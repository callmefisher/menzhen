import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PatientForm from '../PatientForm';

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

vi.mock('../../../api/patient', () => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  getPatient: vi.fn(),
}));

describe('PatientForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <PatientForm />
      </MemoryRouter>
    );

  it('renders the form with fields', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('新增患者')).toBeInTheDocument();
    });
    expect(screen.getByText('姓名')).toBeInTheDocument();
    expect(screen.getByText('性别')).toBeInTheDocument();
    expect(screen.getByText('年龄')).toBeInTheDocument();
    expect(screen.getByText('男')).toBeInTheDocument();
    expect(screen.getByText('女')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入患者姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入年龄')).toBeInTheDocument();
  });
});
