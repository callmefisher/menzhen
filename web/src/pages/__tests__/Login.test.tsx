import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../Login';

const mockLogin = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../store/auth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: mockLogin,
  }),
}));

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

// Mock LoginBackground to render children without canvas/animation
vi.mock('../LoginBackground', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderLogin = () =>
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

  it('renders login form with username and password fields', () => {
    renderLogin();

    expect(screen.getByPlaceholderText('请输入用户名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
    expect(screen.getByText('记住我')).toBeInTheDocument();
    expect(screen.getByText('欢迎回来')).toBeInTheDocument();
    expect(screen.getByText('立即注册')).toBeInTheDocument();
  });

  it('has required attributes on inputs for validation', () => {
    renderLogin();

    const usernameInput = screen.getByPlaceholderText('请输入用户名');
    const passwordInput = screen.getByPlaceholderText('请输入密码');

    expect(usernameInput).toBeRequired();
    expect(passwordInput).toBeRequired();
  });

  it('calls login with credentials on valid form submission', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByPlaceholderText('请输入用户名'), 'admin');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'password123', false);
    });
  });
});
