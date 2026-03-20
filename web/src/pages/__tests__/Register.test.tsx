import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Register from '../Register';

vi.mock('../../api/auth', () => ({
  register: vi.fn(),
}));

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return { ...actual, message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

// Mock LoginBackground to render children without canvas/animation
vi.mock('../LoginBackground', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  );
}

describe('Register', () => {
  it('renders registration form with all fields', () => {
    const { container } = renderRegister();

    expect(screen.getByText('创建账号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入诊所编码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入用户名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码（至少 6 位）')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('再次输入密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入真实姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('手机号（选填）')).toBeInTheDocument();
    const submitBtn = container.querySelector('button[type="submit"]');
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn!.textContent).toMatch(/注\s*册/);
  });

  it('renders link to login page', () => {
    renderRegister();

    expect(screen.getByText('返回登录')).toBeInTheDocument();
    const loginLink = screen.getByText('返回登录');
    expect(loginLink.closest('a')).toHaveAttribute('href', '/login');
  });
});
