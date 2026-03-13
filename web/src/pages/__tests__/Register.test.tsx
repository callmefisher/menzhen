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

    expect(screen.getByText('注册账号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('诊所编码（默认：default）')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('确认密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('真实姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('手机号（选填）')).toBeInTheDocument();
    // Submit button: Ant Design renders <button type="submit"><span>注册</span></button>
    const submitBtn = container.querySelector('button[type="submit"]');
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn!.textContent).toMatch(/注\s*册/);
  });

  it('renders link to login page', () => {
    renderRegister();

    expect(screen.getByText('已有账号？')).toBeInTheDocument();
    const loginLink = screen.getByText('返回登录');
    expect(loginLink).toBeInTheDocument();
    expect(loginLink.closest('a')).toHaveAttribute('href', '/login');
  });
});
